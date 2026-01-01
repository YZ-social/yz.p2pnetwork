/**
 * Message Router for Overlay Messaging Network
 *
 * Routes messages using DHT routing table, handles forwarding,
 * and manages response routing back to origin nodes.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3
 */

import type { DHTNode } from '../dht/node.js';
import { MessageType, UnreachableReason } from './constants.js';
import { OverlayError, OverlayErrorCode } from './errors.js';
import type {
  RequestMessage,
  ResponseMessage,
  UnreachableMessage,
} from './types.js';

/**
 * Result of routing a message
 */
export interface RouteResult {
  /** Whether the message was delivered to the target */
  delivered: boolean;
  /** Peer IDs of next hops the message was forwarded to */
  nextHops?: string[];
  /** Error if routing failed */
  error?: OverlayError;
}

/**
 * Configuration for the message router
 */
export interface MessageRouterConfig {
  /** Default number of parallel paths for redundancy */
  defaultRedundancy?: number;
}

/**
 * Message Router class
 *
 * Integrates with DHTNode for peer lookup and implements
 * message forwarding and response routing logic.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3
 */
export class MessageRouter {
  private readonly dht: DHTNode;
  private readonly localPeerId: string;
  private readonly defaultRedundancy: number;

  /**
   * Create a new MessageRouter instance.
   *
   * @param dht - The DHT node to use for peer lookup
   * @param config - Optional router configuration
   */
  constructor(dht: DHTNode, config?: MessageRouterConfig) {
    this.dht = dht;
    this.localPeerId = dht.peerId.toString();
    this.defaultRedundancy = config?.defaultRedundancy ?? 3;
  }

  /**
   * Get the local peer ID
   */
  get peerId(): string {
    return this.localPeerId;
  }

  /**
   * Get next hops for routing to a target peer.
   * Uses DHT routing to find the closest known peers to the target.
   *
   * Requirement 4.1: Forward to closest known peers to the target
   *
   * @param targetPeerId - The target peer ID to route to
   * @param count - Number of next hops to return (default: defaultRedundancy)
   * @returns Array of peer IDs representing next hops
   */
  async getNextHops(targetPeerId: string, count?: number): Promise<string[]> {
    const numHops = count ?? this.defaultRedundancy;
    const nextHops: string[] = [];

    try {
      // Convert target peer ID to bytes for DHT lookup
      const targetKey = new TextEncoder().encode(targetPeerId);

      // Get closest peers from DHT
      for await (const peer of this.dht.getClosestPeers(targetKey)) {
        const peerId = peer.id.toString();

        // Skip self
        if (peerId === this.localPeerId) {
          continue;
        }

        nextHops.push(peerId);

        if (nextHops.length >= numHops) {
          break;
        }
      }
    } catch (error) {
      // If DHT lookup fails, return empty array
      // The caller will handle the NO_ROUTE case
    }

    return nextHops;
  }


  /**
   * Prepare a request message for forwarding.
   * Decrements TTL and appends this node's peer ID to the path.
   *
   * Requirements 4.2, 4.3: TTL decrement and path tracking
   *
   * @param message - The request message to prepare for forwarding
   * @returns The prepared message with updated TTL and path, or an error
   */
  prepareForForward(message: RequestMessage): RequestMessage | UnreachableMessage {
    // Requirement 4.4: If TTL reaches 0, return UNREACHABLE error
    if (message.ttl <= 0) {
      return {
        type: MessageType.UNREACHABLE,
        messageId: message.messageId,
        reason: UnreachableReason.TTL_EXPIRED,
      };
    }

    // Requirement 4.2: Decrement TTL by 1
    const newTtl = message.ttl - 1;

    // Requirement 4.3: Append this node's peer ID to the path
    const newPath = [...message.path, this.localPeerId];

    return {
      ...message,
      ttl: newTtl,
      path: newPath,
    };
  }

  /**
   * Check if a message is destined for this node.
   *
   * @param targetPeerId - The target peer ID from the message
   * @returns true if this node is the target
   */
  isLocalTarget(targetPeerId: string): boolean {
    return targetPeerId === this.localPeerId;
  }

  /**
   * Route a request message toward its target.
   * If this node is the target, returns delivered=true.
   * Otherwise, finds next hops and prepares the message for forwarding.
   *
   * Requirement 4.1: Forward to closest known peers to the target
   *
   * @param message - The request message to route
   * @returns RouteResult indicating delivery status and next hops
   */
  async routeMessage(message: RequestMessage): Promise<RouteResult> {
    // Check if this node is the target
    if (this.isLocalTarget(message.targetPeerId)) {
      return { delivered: true };
    }

    // Prepare message for forwarding (decrement TTL, update path)
    const prepared = this.prepareForForward(message);

    // Check if TTL expired
    if (prepared.type === MessageType.UNREACHABLE) {
      return {
        delivered: false,
        error: new OverlayError(
          OverlayErrorCode.TTL_EXPIRED,
          'Message TTL expired before reaching target',
          { messageId: message.messageId }
        ),
      };
    }

    // Get next hops from DHT
    const nextHops = await this.getNextHops(message.targetPeerId);

    // Requirement 4.5: If no closer peers are known, return NO_ROUTE error
    if (nextHops.length === 0) {
      return {
        delivered: false,
        error: new OverlayError(
          OverlayErrorCode.NO_ROUTE,
          'No route to target peer',
          {
            messageId: message.messageId,
            context: { targetPeerId: message.targetPeerId },
          }
        ),
      };
    }

    return {
      delivered: false,
      nextHops,
    };
  }

  /**
   * Get the reverse path for routing a response back to the origin.
   * The reverse path is the request path in reverse order.
   *
   * Requirement 5.2: Support routing responses via reverse of request path
   *
   * @param requestPath - The path from the original request
   * @returns The reversed path for response routing
   */
  getReversePath(requestPath: string[]): string[] {
    return [...requestPath].reverse();
  }

  /**
   * Route a response message back to the origin.
   * Supports both reverse path routing and DHT-based routing.
   *
   * Requirements 5.1, 5.2, 5.3: Response routing
   *
   * @param response - The response message to route
   * @param useReversePath - Whether to use reverse path routing (default: true)
   * @returns RouteResult indicating next hops for the response
   */
  async routeResponse(
    response: ResponseMessage,
    useReversePath: boolean = true
  ): Promise<RouteResult> {
    // Check if this node is the origin (response destination)
    if (response.originPeerId === this.localPeerId) {
      return { delivered: true };
    }

    let nextHops: string[] = [];

    if (useReversePath && response.path.length > 0) {
      // Requirement 5.2: Use reverse path routing
      // The next hop is the last peer in the response path
      // (which was the previous hop on the way to the target)
      const reversePath = this.getReversePath(response.path);
      
      // Find the first peer in reverse path that isn't us
      for (const peerId of reversePath) {
        if (peerId !== this.localPeerId) {
          nextHops = [peerId];
          break;
        }
      }
    }

    // Requirement 5.3: Fall back to DHT-based routing if reverse path is empty
    if (nextHops.length === 0) {
      nextHops = await this.getNextHops(response.originPeerId, 1);
    }

    if (nextHops.length === 0) {
      // Requirement 5.5: If response cannot reach origin, fail silently
      // The origin will timeout
      return {
        delivered: false,
        error: new OverlayError(
          OverlayErrorCode.NO_ROUTE,
          'No route to origin peer for response',
          {
            messageId: response.messageId,
            context: { originPeerId: response.originPeerId },
          }
        ),
      };
    }

    return {
      delivered: false,
      nextHops,
    };
  }

  /**
   * Get the prepared message after forwarding preparation.
   * This is a convenience method that returns the forwarded message
   * with updated TTL and path.
   *
   * @param message - The original request message
   * @returns The prepared message or null if TTL expired
   */
  getForwardedMessage(message: RequestMessage): RequestMessage | null {
    const prepared = this.prepareForForward(message);
    if (prepared.type === MessageType.UNREACHABLE) {
      return null;
    }
    return prepared as RequestMessage;
  }
}
