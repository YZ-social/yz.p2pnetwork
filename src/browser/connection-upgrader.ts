/**
 * Connection Upgrader for Browser Nodes
 * 
 * Manages periodic attempts to upgrade relayed connections to direct WebRTC connections.
 * This improves network efficiency by reducing relay load when direct connections become possible.
 * 
 * Features:
 * - Tracks relayed connections
 * - Periodically attempts direct WebRTC connection
 * - Upgrades to direct connection if successful
 * - Configurable retry intervals
 * 
 * Requirements: 3.4, 10.6
 */

import type { Connection, PeerId } from '@libp2p/interface';
import type { Multiaddr } from '@multiformats/multiaddr';

/**
 * Configuration for connection upgrader
 */
export interface ConnectionUpgraderConfig {
  /** Interval between upgrade attempts in ms (default: 60000 - 1 minute) */
  upgradeInterval: number;
  /** Maximum number of upgrade attempts per connection (default: 10) */
  maxUpgradeAttempts: number;
  /** Whether to enable automatic upgrade attempts (default: true) */
  enabled: boolean;
}

/**
 * Default connection upgrader configuration
 */
export const DEFAULT_CONNECTION_UPGRADER_CONFIG: ConnectionUpgraderConfig = {
  upgradeInterval: 60000, // 1 minute
  maxUpgradeAttempts: 10,
  enabled: true,
};

/**
 * Information about a relayed connection being tracked for upgrade
 */
export interface RelayedConnectionInfo {
  /** The peer ID of the remote peer */
  peerId: string;
  /** The connection ID */
  connectionId: string;
  /** Number of upgrade attempts made */
  upgradeAttempts: number;
  /** Timestamp of last upgrade attempt */
  lastAttemptTime: number;
  /** Whether an upgrade is currently in progress */
  upgradeInProgress: boolean;
  /** Known multiaddrs for direct connection attempts */
  directMultiaddrs: string[];
}

/**
 * Result of an upgrade attempt
 */
export interface UpgradeAttemptResult {
  /** The peer ID that was attempted */
  peerId: string;
  /** Whether the upgrade succeeded */
  success: boolean;
  /** The transport type of the new connection (if successful) */
  newTransport?: 'webrtc' | 'websocket';
  /** Error message if failed */
  error?: string;
  /** Number of attempts made for this peer */
  attemptNumber: number;
}

/**
 * Event types emitted by ConnectionUpgrader
 */
export type ConnectionUpgraderEvent =
  | { type: 'upgrade-started'; peerId: string; attemptNumber: number }
  | { type: 'upgrade-success'; peerId: string; newTransport: 'webrtc' | 'websocket' }
  | { type: 'upgrade-failed'; peerId: string; error: string; attemptNumber: number }
  | { type: 'max-attempts-reached'; peerId: string }
  | { type: 'connection-tracked'; peerId: string }
  | { type: 'connection-untracked'; peerId: string };

/**
 * Callback type for connection upgrader events
 */
export type ConnectionUpgraderEventHandler = (event: ConnectionUpgraderEvent) => void;

/**
 * Interface for the dial function used to attempt direct connections
 */
export interface DialFunction {
  (multiaddr: Multiaddr | string): Promise<Connection>;
}

/**
 * Interface for getting peer multiaddrs
 */
export interface PeerStore {
  get(peerId: PeerId | string): Promise<{ addresses: Array<{ multiaddr: Multiaddr }> } | undefined>;
}

/**
 * Manages periodic upgrade attempts for relayed connections
 */
export class ConnectionUpgrader {
  private config: ConnectionUpgraderConfig;
  private relayedConnections: Map<string, RelayedConnectionInfo> = new Map();
  private upgradeTimer: ReturnType<typeof setInterval> | null = null;
  private eventHandlers: ConnectionUpgraderEventHandler[] = [];
  private dialFn: DialFunction | null = null;
  private peerStore: PeerStore | null = null;
  private getConnectionsFn: (() => Connection[]) | null = null;
  private started = false;

  constructor(config: Partial<ConnectionUpgraderConfig> = {}) {
    this.config = {
      ...DEFAULT_CONNECTION_UPGRADER_CONFIG,
      ...config,
    };
  }

  /**
   * Initialize the upgrader with libp2p functions
   */
  initialize(
    dial: DialFunction,
    peerStore: PeerStore,
    getConnections: () => Connection[]
  ): void {
    this.dialFn = dial;
    this.peerStore = peerStore;
    this.getConnectionsFn = getConnections;
  }

  /**
   * Start the periodic upgrade timer
   */
  start(): void {
    if (this.started || !this.config.enabled) {
      return;
    }

    this.started = true;
    this.upgradeTimer = setInterval(() => {
      this.attemptUpgrades();
    }, this.config.upgradeInterval);
  }

  /**
   * Stop the periodic upgrade timer
   */
  stop(): void {
    if (this.upgradeTimer) {
      clearInterval(this.upgradeTimer);
      this.upgradeTimer = null;
    }
    this.started = false;
  }

  /**
   * Check if the upgrader is running
   */
  isRunning(): boolean {
    return this.started;
  }

  /**
   * Track a relayed connection for potential upgrade
   */
  trackRelayedConnection(
    peerId: string,
    connectionId: string,
    directMultiaddrs: string[] = []
  ): void {
    if (this.relayedConnections.has(peerId)) {
      // Update existing entry with new connection info
      const existing = this.relayedConnections.get(peerId)!;
      existing.connectionId = connectionId;
      existing.directMultiaddrs = [
        ...new Set([...existing.directMultiaddrs, ...directMultiaddrs]),
      ];
      return;
    }

    this.relayedConnections.set(peerId, {
      peerId,
      connectionId,
      upgradeAttempts: 0,
      lastAttemptTime: 0,
      upgradeInProgress: false,
      directMultiaddrs,
    });

    this.emit({ type: 'connection-tracked', peerId });
  }

  /**
   * Stop tracking a connection (e.g., when it's closed or upgraded)
   */
  untrackConnection(peerId: string): void {
    if (this.relayedConnections.delete(peerId)) {
      this.emit({ type: 'connection-untracked', peerId });
    }
  }

  /**
   * Get all tracked relayed connections
   */
  getTrackedConnections(): RelayedConnectionInfo[] {
    return Array.from(this.relayedConnections.values());
  }

  /**
   * Get the number of tracked connections
   */
  getTrackedConnectionCount(): number {
    return this.relayedConnections.size;
  }

  /**
   * Check if a peer has a tracked relayed connection
   */
  isTracked(peerId: string): boolean {
    return this.relayedConnections.has(peerId);
  }

  /**
   * Get upgrade attempt count for a peer
   */
  getUpgradeAttemptCount(peerId: string): number {
    return this.relayedConnections.get(peerId)?.upgradeAttempts ?? 0;
  }

  /**
   * Attempt to upgrade all eligible relayed connections
   */
  async attemptUpgrades(): Promise<UpgradeAttemptResult[]> {
    const results: UpgradeAttemptResult[] = [];

    for (const [peerId, info] of this.relayedConnections) {
      // Skip if upgrade is already in progress
      if (info.upgradeInProgress) {
        continue;
      }

      // Skip if max attempts reached
      if (info.upgradeAttempts >= this.config.maxUpgradeAttempts) {
        continue;
      }

      const result = await this.attemptUpgrade(peerId);
      results.push(result);
    }

    return results;
  }

  /**
   * Attempt to upgrade a specific relayed connection to direct
   */
  async attemptUpgrade(peerId: string): Promise<UpgradeAttemptResult> {
    const info = this.relayedConnections.get(peerId);
    if (!info) {
      return {
        peerId,
        success: false,
        error: 'Connection not tracked',
        attemptNumber: 0,
      };
    }

    if (info.upgradeInProgress) {
      return {
        peerId,
        success: false,
        error: 'Upgrade already in progress',
        attemptNumber: info.upgradeAttempts,
      };
    }

    if (info.upgradeAttempts >= this.config.maxUpgradeAttempts) {
      this.emit({ type: 'max-attempts-reached', peerId });
      return {
        peerId,
        success: false,
        error: 'Max upgrade attempts reached',
        attemptNumber: info.upgradeAttempts,
      };
    }

    if (!this.dialFn) {
      return {
        peerId,
        success: false,
        error: 'Dial function not initialized',
        attemptNumber: info.upgradeAttempts,
      };
    }

    // Mark upgrade in progress
    info.upgradeInProgress = true;
    info.upgradeAttempts++;
    info.lastAttemptTime = Date.now();

    const attemptNumber = info.upgradeAttempts;
    this.emit({ type: 'upgrade-started', peerId, attemptNumber });

    try {
      // Get direct multiaddrs for the peer
      const directAddrs = await this.getDirectMultiaddrs(peerId, info);

      if (directAddrs.length === 0) {
        info.upgradeInProgress = false;
        const error = 'No direct multiaddrs available';
        this.emit({ type: 'upgrade-failed', peerId, error, attemptNumber });
        return {
          peerId,
          success: false,
          error,
          attemptNumber,
        };
      }

      // Try each direct address
      for (const addr of directAddrs) {
        try {
          const newConn = await this.dialFn(addr);
          const newTransport = this.getTransportType(newConn.remoteAddr.toString());

          if (newTransport === 'webrtc' || newTransport === 'websocket') {
            // Success! Close the old relayed connection
            await this.closeRelayedConnection(peerId);
            
            // Remove from tracking
            this.relayedConnections.delete(peerId);
            
            this.emit({ type: 'upgrade-success', peerId, newTransport });
            return {
              peerId,
              success: true,
              newTransport,
              attemptNumber,
            };
          }
        } catch {
          // Try next address
          continue;
        }
      }

      // All addresses failed
      info.upgradeInProgress = false;
      const error = 'All direct connection attempts failed';
      this.emit({ type: 'upgrade-failed', peerId, error, attemptNumber });
      return {
        peerId,
        success: false,
        error,
        attemptNumber,
      };
    } catch (err) {
      info.upgradeInProgress = false;
      const error = err instanceof Error ? err.message : 'Unknown error';
      this.emit({ type: 'upgrade-failed', peerId, error, attemptNumber });
      return {
        peerId,
        success: false,
        error,
        attemptNumber,
      };
    }
  }

  /**
   * Register an event handler
   */
  onEvent(handler: ConnectionUpgraderEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index !== -1) {
        this.eventHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Clear all tracked connections
   */
  clear(): void {
    this.relayedConnections.clear();
  }

  /**
   * Get direct multiaddrs for a peer
   */
  private async getDirectMultiaddrs(
    peerId: string,
    info: RelayedConnectionInfo
  ): Promise<string[]> {
    const directAddrs: string[] = [...info.directMultiaddrs];

    // Try to get additional addresses from peer store
    if (this.peerStore) {
      try {
        const peerInfo = await this.peerStore.get(peerId);
        if (peerInfo?.addresses) {
          for (const addr of peerInfo.addresses) {
            const addrStr = addr.multiaddr.toString();
            // Only include direct addresses (not relay)
            if (!addrStr.includes('/p2p-circuit/')) {
              if (!directAddrs.includes(addrStr)) {
                directAddrs.push(addrStr);
              }
            }
          }
        }
      } catch {
        // Peer not in store, use cached addresses
      }
    }

    // Filter to only WebRTC and WebSocket addresses
    return directAddrs.filter(
      (addr) =>
        addr.includes('/webrtc/') ||
        addr.includes('/webrtc-direct/') ||
        addr.includes('/ws/') ||
        addr.includes('/wss/')
    );
  }

  /**
   * Close the relayed connection for a peer
   */
  private async closeRelayedConnection(peerId: string): Promise<void> {
    if (!this.getConnectionsFn) {
      return;
    }

    const connections = this.getConnectionsFn();
    for (const conn of connections) {
      if (conn.remotePeer.toString() === peerId) {
        const addr = conn.remoteAddr.toString();
        if (addr.includes('/p2p-circuit/')) {
          try {
            await conn.close();
          } catch {
            // Ignore close errors
          }
        }
      }
    }
  }

  /**
   * Determine transport type from multiaddr
   */
  private getTransportType(
    multiaddr: string
  ): 'webrtc' | 'websocket' | 'relay' | null {
    if (multiaddr.includes('/p2p-circuit/')) {
      return 'relay';
    }
    if (
      multiaddr.includes('/webrtc/') ||
      multiaddr.includes('/webrtc-direct/')
    ) {
      return 'webrtc';
    }
    if (
      multiaddr.includes('/ws/') ||
      multiaddr.includes('/wss/') ||
      multiaddr.includes('/websocket/')
    ) {
      return 'websocket';
    }
    return null;
  }

  /**
   * Emit an event to all handlers
   */
  private emit(event: ConnectionUpgraderEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in connection upgrader event handler:', error);
      }
    }
  }
}
