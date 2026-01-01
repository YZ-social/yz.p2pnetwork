/**
 * DHTNode - Main facade for interacting with the Kademlia DHT system.
 * 
 * Provides a simplified API for:
 * - Node lifecycle management (start/stop)
 * - Identity exposure (peerId, multiaddrs)
 * - Bootstrap and network join
 * - Peer discovery operations
 * - Content operations (PUT/GET)
 * - Provider operations (provide/findProviders)
 * - Event handling for peer connect/disconnect
 * 
 * Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 3.1, 3.5, 5.1, 5.2, 5.3, 6.1, 6.5
 */

import { type Libp2p } from 'libp2p';
import { type PeerId } from '@libp2p/interface';
import { type Multiaddr, multiaddr } from '@multiformats/multiaddr';
import { peerIdFromString } from '@libp2p/peer-id';
import { CID } from 'multiformats/cid';

import { type DHTNodeConfig, DEFAULT_CONFIG } from './config.js';
import { createLibp2pNode } from './factory.js';
import { DHTError, DHTErrorCode } from './errors.js';
import { xorDistance, compareDistance } from './distance.js';
import { getRoutingTableInfo, type RoutingTableInfo, type BucketInfo, type RoutingPeerInfo } from './routing.js';

// Re-export routing types for convenience
export type { RoutingTableInfo, BucketInfo, RoutingPeerInfo };

// Re-export CID for convenience
export { CID };

/**
 * Connection management information
 */
export interface ConnectionInfo {
  /** Current number of open connections */
  currentConnections: number;
  /** Maximum allowed connections from config */
  maxConnections: number;
  /** Minimum connections to maintain from config */
  minConnections: number;
  /** List of connected peer IDs */
  connectedPeers: string[];
}

/**
 * Information about a peer in the network
 */
export interface PeerInfo {
  id: PeerId;
  multiaddrs: Multiaddr[];
  latency?: number;
  lastSeen?: Date;
}

/**
 * Event types emitted by DHTNode
 */
export type DHTNodeEventType = 
  | 'peer:connect'
  | 'peer:disconnect'
  | 'dht:routing:refresh';

/**
 * Event handler function type
 */
export type DHTNodeEventHandler<T = unknown> = (data: T) => void;

/**
 * Main DHT node facade class.
 * Wraps libp2p node and provides simplified DHT operations.
 */
export class DHTNode {
  private node: Libp2p | null = null;
  private readonly config: DHTNodeConfig;
  private started = false;
  private eventHandlers: Map<DHTNodeEventType, Set<DHTNodeEventHandler<PeerId>>> = new Map();

  /**
   * Create a new DHTNode instance.
   * Note: Call start() to initialize and start the node.
   * 
   * @param config - DHT node configuration
   */
  constructor(config: DHTNodeConfig) {
    this.config = config;
  }

  /**
   * Get the peer ID of this node.
   * @throws DHTError if node is not started
   */
  get peerId(): PeerId {
    this.ensureStarted();
    return this.node!.peerId;
  }

  /**
   * Get the multiaddresses this node is listening on.
   * @throws DHTError if node is not started
   */
  get multiaddrs(): Multiaddr[] {
    this.ensureStarted();
    return this.node!.getMultiaddrs();
  }

  /**
   * Check if the node is currently running.
   */
  get isStarted(): boolean {
    return this.started;
  }

  /**
   * Start the DHT node.
   * Initializes the libp2p node, starts listening on configured addresses,
   * and initializes the Kademlia routing table.
   * 
   * Requirements: 1.1, 1.2, 1.3
   * 
   * @throws DHTError if node fails to start
   */
  async start(): Promise<void> {
    if (this.started) {
      return; // Already started, idempotent
    }

    try {
      // Create the libp2p node
      this.node = await createLibp2pNode(this.config);

      // Set up event listeners
      this.setupEventListeners();

      // Start the node
      await this.node.start();
      this.started = true;
    } catch (error) {
      // Clean up on failure
      this.node = null;
      this.started = false;

      if (error instanceof DHTError) {
        throw error;
      }

      throw new DHTError(
        DHTErrorCode.KEY_GENERATION_FAILED,
        `Failed to start DHT node: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }

  /**
   * Stop the DHT node.
   * Gracefully shuts down connections and releases resources.
   * 
   * Requirements: 6.1
   */
  async stop(): Promise<void> {
    if (!this.started || !this.node) {
      return; // Already stopped, idempotent
    }

    try {
      // Remove event listeners
      this.removeEventListeners();

      // Stop the node
      await this.node.stop();
    } finally {
      this.node = null;
      this.started = false;
    }
  }


  /**
   * Bootstrap the node by connecting to bootstrap peers.
   * If no peers are provided, uses the bootstrap peers from configuration.
   * 
   * Requirements: 2.1, 2.2, 2.3, 2.4
   * 
   * @param peers - Optional array of multiaddr strings to bootstrap from
   * @throws DHTError with BOOTSTRAP_FAILED if all bootstrap peers are unreachable
   */
  async bootstrap(peers?: string[]): Promise<void> {
    this.ensureStarted();

    const bootstrapPeers = peers ?? this.config.bootstrapPeers ?? [];

    if (bootstrapPeers.length === 0) {
      // No bootstrap peers - node will operate in standalone mode
      return;
    }

    const errors: Error[] = [];
    let connectedCount = 0;

    for (const peerAddr of bootstrapPeers) {
      try {
        const ma = multiaddr(peerAddr);
        await this.node!.dial(ma);
        connectedCount++;
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    // If all bootstrap peers failed, throw an error
    if (connectedCount === 0 && bootstrapPeers.length > 0) {
      throw new DHTError(
        DHTErrorCode.BOOTSTRAP_FAILED,
        `Failed to connect to any bootstrap peers. Attempted ${bootstrapPeers.length} peer(s).`,
        {
          context: {
            attemptedPeers: bootstrapPeers,
            errors: errors.map(e => e.message),
          },
        }
      );
    }

    // Perform initial self-lookup to populate routing table with nearby peers
    // This helps discover other nodes in the network beyond just the bootstrap peers
    try {
      const selfKey = this.node!.peerId.toMultihash().bytes;
      // Iterate through closest peers to trigger DHT queries
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _peer of this.getClosestPeers(selfKey)) {
        // Just iterating triggers the DHT lookup which populates routing table
        // We don't need to do anything with the peers
      }
    } catch {
      // Self-lookup failure is not critical, routing table will populate over time
    }

    // Perform additional random lookups to discover more peers
    // This helps build a more complete routing table
    try {
      const randomKey = new Uint8Array(32);
      crypto.getRandomValues(randomKey);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _peer of this.getClosestPeers(randomKey)) {
        // Just iterating triggers the DHT lookup
      }
    } catch {
      // Random lookup failure is not critical
    }
  }

  /**
   * Find a specific peer in the network.
   * 
   * Requirements: 3.1
   * 
   * @param peerId - The peer ID to find (can be string or PeerId object)
   * @returns Promise resolving to PeerInfo for the found peer
   * @throws DHTError with NOT_FOUND if peer cannot be found
   */
  async findPeer(peerId: PeerId | string): Promise<PeerInfo> {
    this.ensureStarted();

    const targetPeerId = typeof peerId === 'string' ? peerIdFromString(peerId) : peerId;

    try {
      // Access the DHT service
      const dht = this.getDHTService();
      
      // Use DHT to find the peer
      for await (const event of dht.findPeer(targetPeerId)) {
        if (event.name === 'FINAL_PEER') {
          return {
            id: event.peer.id,
            multiaddrs: event.peer.multiaddrs,
            lastSeen: new Date(),
          };
        }
      }

      // If we get here, peer was not found
      throw new DHTError(
        DHTErrorCode.NOT_FOUND,
        `Peer not found: ${targetPeerId.toString()}`,
        { context: { peerId: targetPeerId.toString() } }
      );
    } catch (error) {
      if (error instanceof DHTError) {
        throw error;
      }

      throw new DHTError(
        DHTErrorCode.NOT_FOUND,
        `Failed to find peer: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {
          cause: error instanceof Error ? error : undefined,
          context: { peerId: targetPeerId.toString() },
        }
      );
    }
  }

  /**
   * Store a key-value pair in the DHT.
   * The value is stored at the k closest peers to the key.
   * 
   * Requirements: 4.1, 4.4
   * 
   * @param key - The key to store the value under
   * @param value - The value to store
   * @throws DHTError with INVALID_RECORD if key or value is invalid
   * @throws DHTError with PUT_FAILED if the operation fails
   */
  async put(key: Uint8Array, value: Uint8Array): Promise<void> {
    this.ensureStarted();

    // Validate key-value pair
    this.validateKeyValue(key, value);

    try {
      const dht = this.getDHTService();
      
      // Use DHT to store the value
      // The DHT service handles storing at k closest peers
      await dht.put(key, value);
    } catch (error) {
      if (error instanceof DHTError) {
        throw error;
      }

      throw new DHTError(
        DHTErrorCode.PUT_FAILED,
        `Failed to store value in DHT: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {
          cause: error instanceof Error ? error : undefined,
          context: { keyLength: key.length, valueLength: value.length },
        }
      );
    }
  }

  /**
   * Retrieve a value from the DHT by key.
   * Queries peers closest to the key to find the value.
   * 
   * Requirements: 4.2, 4.3
   * 
   * @param key - The key to retrieve the value for
   * @returns The stored value
   * @throws DHTError with INVALID_RECORD if key is invalid
   * @throws DHTError with NOT_FOUND if the key is not found
   */
  async get(key: Uint8Array): Promise<Uint8Array> {
    this.ensureStarted();

    // Validate key
    if (!key || key.length === 0) {
      throw new DHTError(
        DHTErrorCode.INVALID_RECORD,
        'Key cannot be empty',
        { context: { keyLength: key?.length ?? 0 } }
      );
    }

    try {
      const dht = this.getDHTService();
      
      // Use DHT to retrieve the value
      // The DHT get() returns an async generator of query events
      for await (const event of dht.get(key)) {
        if (event.name === 'VALUE') {
          return event.value;
        }
      }
      
      // If we get here, no value was found
      throw new DHTError(
        DHTErrorCode.NOT_FOUND,
        'Key not found in DHT',
        { context: { keyLength: key.length } }
      );
    } catch (error) {
      if (error instanceof DHTError) {
        throw error;
      }

      // Check if it's a not-found error from the DHT
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.toLowerCase().includes('not found') || 
          errorMessage.toLowerCase().includes('no value')) {
        throw new DHTError(
          DHTErrorCode.NOT_FOUND,
          'Key not found in DHT',
          {
            cause: error instanceof Error ? error : undefined,
            context: { keyLength: key.length },
          }
        );
      }

      throw new DHTError(
        DHTErrorCode.NOT_FOUND,
        `Failed to retrieve value from DHT: ${errorMessage}`,
        {
          cause: error instanceof Error ? error : undefined,
          context: { keyLength: key.length },
        }
      );
    }
  }

  /**
   * Get the closest peers to a given key.
   * Returns peers ordered by ascending XOR distance to the target key.
   * 
   * Requirements: 3.1, 3.5
   * 
   * @param key - The key to find closest peers for
   * @yields PeerInfo objects for peers closest to the key
   */
  async *getClosestPeers(key: Uint8Array): AsyncIterable<PeerInfo> {
    this.ensureStarted();

    try {
      const dht = this.getDHTService();
      const peers: PeerInfo[] = [];

      // Collect peers from DHT query
      for await (const event of dht.getClosestPeers(key)) {
        if (event.name === 'PEER_RESPONSE') {
          for (const closer of event.closer) {
            peers.push({
              id: closer.id,
              multiaddrs: closer.multiaddrs,
              lastSeen: new Date(),
            });
          }
        }
        if (event.name === 'FINAL_PEER') {
          peers.push({
            id: event.peer.id,
            multiaddrs: event.peer.multiaddrs,
            lastSeen: new Date(),
          });
        }
      }

      // Sort peers by XOR distance to the key
      const sortedPeers = this.sortPeersByDistance(peers, key);

      // Yield unique peers
      const seen = new Set<string>();
      for (const peer of sortedPeers) {
        const peerIdStr = peer.id.toString();
        if (!seen.has(peerIdStr)) {
          seen.add(peerIdStr);
          yield peer;
        }
      }
    } catch (error) {
      throw new DHTError(
        DHTErrorCode.NOT_FOUND,
        `Failed to get closest peers: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }

  /**
   * Advertise that this node can provide content for the given CID.
   * Publishes a provider record to the k closest peers to the content key.
   * 
   * Requirements: 5.1, 5.3
   * 
   * @param key - The CID of the content to provide (can be CID object or string)
   * @throws DHTError with INVALID_RECORD if CID is invalid
   * @throws DHTError with PROVIDE_FAILED if the operation fails
   */
  async provide(key: CID | string): Promise<void> {
    this.ensureStarted();

    // Parse CID if string
    const cid = this.parseCID(key);

    try {
      const dht = this.getDHTService();
      
      // Use DHT to publish provider record
      // The DHT service handles publishing to k closest peers
      await dht.provide(cid);
    } catch (error) {
      if (error instanceof DHTError) {
        throw error;
      }

      throw new DHTError(
        DHTErrorCode.PROVIDE_FAILED,
        `Failed to provide content: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {
          cause: error instanceof Error ? error : undefined,
          context: { cid: cid.toString() },
        }
      );
    }
  }

  /**
   * Find peers that are providing content for the given CID.
   * Returns an async iterable of peers advertising the content.
   * 
   * Requirements: 5.2
   * 
   * @param key - The CID of the content to find providers for (can be CID object or string)
   * @yields PeerInfo objects for peers providing the content
   * @throws DHTError with INVALID_RECORD if CID is invalid
   * @throws DHTError with NO_PROVIDERS if no providers are found
   */
  async *findProviders(key: CID | string): AsyncIterable<PeerInfo> {
    this.ensureStarted();

    // Parse CID if string
    const cid = this.parseCID(key);

    try {
      const dht = this.getDHTService();
      let foundAny = false;

      // Use DHT to find providers
      for await (const event of dht.findProviders(cid)) {
        if (event.name === 'PROVIDER') {
          for (const provider of event.providers) {
            foundAny = true;
            yield {
              id: provider.id,
              multiaddrs: provider.multiaddrs,
              lastSeen: new Date(),
            };
          }
        }
      }

      // Note: We don't throw NO_PROVIDERS here because the caller may want to
      // handle the empty case themselves. The async iterable simply yields nothing.
      // If the caller needs to know if any providers were found, they can track it.
      if (!foundAny) {
        // Optionally log or handle no providers case
        // For now, we just complete the iteration with no yields
      }
    } catch (error) {
      if (error instanceof DHTError) {
        throw error;
      }

      throw new DHTError(
        DHTErrorCode.NO_PROVIDERS,
        `Failed to find providers: ${error instanceof Error ? error.message : 'Unknown error'}`,
        {
          cause: error instanceof Error ? error : undefined,
          context: { cid: cid.toString() },
        }
      );
    }
  }

  /**
   * Register an event handler for DHT node events.
   * 
   * Requirements: 6.5
   * 
   * @param event - Event type to listen for
   * @param handler - Handler function to call when event occurs
   */
  on(event: 'peer:connect', handler: DHTNodeEventHandler<PeerId>): void;
  on(event: 'peer:disconnect', handler: DHTNodeEventHandler<PeerId>): void;
  on(event: 'dht:routing:refresh', handler: DHTNodeEventHandler<void>): void;
  on(event: DHTNodeEventType, handler: DHTNodeEventHandler<PeerId> | DHTNodeEventHandler<void>): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler as DHTNodeEventHandler<PeerId>);
  }

  /**
   * Remove an event handler.
   * 
   * @param event - Event type
   * @param handler - Handler function to remove
   */
  off(event: DHTNodeEventType, handler: DHTNodeEventHandler<PeerId> | DHTNodeEventHandler<void>): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler as DHTNodeEventHandler<PeerId>);
    }
  }

  /**
   * Get the underlying libp2p node (for advanced use cases).
   * @throws DHTError if node is not started
   */
  getLibp2pNode(): Libp2p {
    this.ensureStarted();
    return this.node!;
  }

  /**
   * Get routing table diagnostic information.
   * Returns information about the current state of the Kademlia routing table,
   * including bucket organization and peer distribution.
   * 
   * Requirements: 3.4
   * 
   * @returns RoutingTableInfo containing bucket and peer information
   * @throws DHTError if node is not started
   */
  getRoutingTableInfo(): RoutingTableInfo {
    this.ensureStarted();
    return getRoutingTableInfo(this.node!);
  }

  /**
   * Get connection management information.
   * Returns current connection state including counts and limits.
   * 
   * Requirements: 6.2, 6.3, 6.4
   * 
   * @returns ConnectionInfo with current connection state
   * @throws DHTError if node is not started
   */
  getConnectionInfo(): ConnectionInfo {
    this.ensureStarted();
    
    const connections = this.node!.getConnections();
    const connectedPeers = new Set<string>();
    
    for (const conn of connections) {
      connectedPeers.add(conn.remotePeer.toString());
    }
    
    return {
      currentConnections: connections.length,
      maxConnections: this.config.maxConnections ?? DEFAULT_CONFIG.maxConnections,
      minConnections: this.config.minConnections ?? DEFAULT_CONFIG.minConnections,
      connectedPeers: Array.from(connectedPeers),
    };
  }

  /**
   * Check if the node can accept more connections.
   * Returns true if current connections are below the maximum limit.
   * 
   * Requirements: 6.3
   * 
   * @returns true if more connections can be accepted
   * @throws DHTError if node is not started
   */
  canAcceptConnections(): boolean {
    this.ensureStarted();
    const info = this.getConnectionInfo();
    return info.currentConnections < info.maxConnections;
  }

  /**
   * Get the number of current connections.
   * 
   * Requirements: 6.2
   * 
   * @returns number of active connections
   * @throws DHTError if node is not started
   */
  getConnectionCount(): number {
    this.ensureStarted();
    return this.node!.getConnections().length;
  }

  // ============ Private Methods ============

  /**
   * Validate a key-value pair before storage.
   * @throws DHTError with INVALID_RECORD if validation fails
   */
  private validateKeyValue(key: Uint8Array, value: Uint8Array): void {
    if (!key || key.length === 0) {
      throw new DHTError(
        DHTErrorCode.INVALID_RECORD,
        'Key cannot be empty',
        { context: { keyLength: key?.length ?? 0 } }
      );
    }

    if (!value) {
      throw new DHTError(
        DHTErrorCode.INVALID_RECORD,
        'Value cannot be null or undefined',
        { context: { keyLength: key.length } }
      );
    }

    // Note: Empty values (length 0) are allowed as they may be valid in some use cases
    // Additional validation can be added here based on specific requirements
  }

  /**
   * Ensure the node is started before performing operations.
   */
  private ensureStarted(): void {
    if (!this.started || !this.node) {
      throw new DHTError(
        DHTErrorCode.INVALID_CONFIG,
        'DHT node is not started. Call start() first.',
      );
    }
  }

  /**
   * Get the DHT service from the libp2p node.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getDHTService(): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const services = (this.node as any).services;
    if (!services?.dht) {
      throw new DHTError(
        DHTErrorCode.INVALID_CONFIG,
        'DHT service is not available on this node',
      );
    }
    return services.dht;
  }

  /**
   * Set up event listeners on the libp2p node.
   */
  private setupEventListeners(): void {
    if (!this.node) return;

    // Listen for peer connections
    this.node.addEventListener('peer:connect', (event) => {
      this.emitEvent('peer:connect', event.detail);
    });

    // Listen for peer disconnections
    this.node.addEventListener('peer:disconnect', (event) => {
      this.emitEvent('peer:disconnect', event.detail);
    });
  }

  /**
   * Remove event listeners from the libp2p node.
   */
  private removeEventListeners(): void {
    // Event listeners are automatically cleaned up when node stops
    this.eventHandlers.clear();
  }

  /**
   * Emit an event to all registered handlers.
   */
  private emitEvent(event: DHTNodeEventType, data: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data as PeerId);
        } catch {
          // Ignore handler errors
        }
      }
    }
  }

  /**
   * Sort peers by XOR distance to a target key.
   */
  private sortPeersByDistance(peers: PeerInfo[], targetKey: Uint8Array): PeerInfo[] {
    return [...peers].sort((a, b) => {
      const distA = xorDistance(a.id.toMultihash().bytes, targetKey);
      const distB = xorDistance(b.id.toMultihash().bytes, targetKey);
      return compareDistance(distA, distB);
    });
  }

  /**
   * Parse a CID from string or return as-is if already a CID.
   * @throws DHTError with INVALID_RECORD if CID is invalid
   */
  private parseCID(key: CID | string): CID {
    if (typeof key === 'string') {
      try {
        return CID.parse(key);
      } catch (error) {
        throw new DHTError(
          DHTErrorCode.INVALID_RECORD,
          `Invalid CID string: ${error instanceof Error ? error.message : 'Unknown error'}`,
          {
            cause: error instanceof Error ? error : undefined,
            context: { cid: key },
          }
        );
      }
    }
    
    // Validate that it's a valid CID object
    if (!key || typeof key.toString !== 'function' || typeof key.multihash !== 'object') {
      throw new DHTError(
        DHTErrorCode.INVALID_RECORD,
        'Invalid CID object',
        { context: { cid: String(key) } }
      );
    }
    
    return key;
  }
}
