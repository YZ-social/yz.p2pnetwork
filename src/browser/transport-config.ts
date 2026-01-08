/**
 * Transport Configuration for Browser Nodes
 * 
 * Configures the libp2p transport stack for browser environments:
 * - WebSocket: For connections to server nodes
 * - WebRTC: For direct browser-to-browser connections
 * - Circuit Relay: For NAT traversal when direct connections fail
 * 
 * Connection Strategy:
 * 1. Attempt direct WebRTC connection first
 * 2. Fall back to circuit relay if direct connection fails
 */

import { webSockets } from '@libp2p/websockets';
import { webRTC } from '@libp2p/webrtc';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import type { Transport } from '@libp2p/interface';

/**
 * Configuration for browser transport setup
 */
export interface BrowserTransportConfig {
  /** Enable WebSocket transport for server connections (default: true) */
  enableWebSocket: boolean;
  /** Enable WebRTC transport for browser-to-browser (default: true) */
  enableWebRTC: boolean;
  /** Enable circuit relay for NAT traversal (default: true) */
  enableCircuitRelay: boolean;
  /** ICE servers for WebRTC (default: Google STUN servers) */
  iceServers: RTCIceServer[];
  /** Number of relay nodes to discover (default: 1) */
  discoverRelays: number;
}

/**
 * Default ICE servers for WebRTC connections
 */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * Default transport configuration
 */
export const DEFAULT_TRANSPORT_CONFIG: BrowserTransportConfig = {
  enableWebSocket: true,
  enableWebRTC: true,
  enableCircuitRelay: true,
  iceServers: DEFAULT_ICE_SERVERS,
  discoverRelays: 1,
};

/**
 * Connection attempt result for tracking connection strategy
 */
export interface ConnectionAttempt {
  /** Target peer ID */
  peerId: string;
  /** Transport type attempted */
  transport: 'webrtc' | 'websocket' | 'relay';
  /** Whether the attempt succeeded */
  success: boolean;
  /** Timestamp of the attempt */
  timestamp: number;
  /** Sequence number for ordering (monotonically increasing) */
  sequence: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Connection strategy tracker for monitoring connection attempts
 * Used to verify that direct WebRTC is attempted before relay
 */
export class ConnectionStrategyTracker {
  private attempts: ConnectionAttempt[] = [];
  private maxAttempts = 1000;
  private sequenceCounter = 0;

  /**
   * Record a connection attempt
   */
  recordAttempt(attempt: Omit<ConnectionAttempt, 'timestamp' | 'sequence'>): void {
    this.attempts.push({
      ...attempt,
      timestamp: Date.now(),
      sequence: this.sequenceCounter++,
    });

    // Prune old attempts to prevent memory growth
    if (this.attempts.length > this.maxAttempts) {
      this.attempts = this.attempts.slice(-this.maxAttempts);
    }
  }

  /**
   * Get all attempts for a specific peer
   */
  getAttemptsForPeer(peerId: string): ConnectionAttempt[] {
    return this.attempts.filter(a => a.peerId === peerId);
  }

  /**
   * Check if direct connection was attempted before relay for a peer
   * Uses sequence numbers for reliable ordering (timestamps can be identical in rapid succession)
   */
  wasDirectAttemptedBeforeRelay(peerId: string): boolean {
    const peerAttempts = this.getAttemptsForPeer(peerId);
    
    const firstRelayAttempt = peerAttempts.find(a => a.transport === 'relay');
    if (!firstRelayAttempt) {
      // No relay attempt, so condition is satisfied
      return true;
    }

    const directAttempts = peerAttempts.filter(
      a => a.transport === 'webrtc' || a.transport === 'websocket'
    );

    // Check if any direct attempt occurred before the first relay attempt
    // Use sequence numbers for reliable ordering
    return directAttempts.some(a => a.sequence < firstRelayAttempt.sequence);
  }

  /**
   * Get all recorded attempts
   */
  getAllAttempts(): ConnectionAttempt[] {
    return [...this.attempts];
  }

  /**
   * Clear all recorded attempts
   */
  clear(): void {
    this.attempts = [];
  }
}

/**
 * Creates the transport configuration for browser libp2p nodes
 * 
 * The transports are ordered to ensure direct connections are attempted
 * before relay connections:
 * 1. WebSocket (for server connections)
 * 2. WebRTC (for direct browser-to-browser)
 * 3. Circuit Relay (fallback for NAT traversal)
 * 
 * @param config - Transport configuration options
 * @returns Array of configured transports
 */
export function createBrowserTransports(
  config: Partial<BrowserTransportConfig> = {}
): (() => Transport)[] {
  const mergedConfig: BrowserTransportConfig = {
    ...DEFAULT_TRANSPORT_CONFIG,
    ...config,
  };

  const transports: (() => Transport)[] = [];

  // WebSocket transport for server connections
  // Added first as it's the primary transport for bootstrap
  if (mergedConfig.enableWebSocket) {
    transports.push(
      webSockets() as unknown as () => Transport
    );
  }

  // WebRTC transport for direct browser-to-browser connections
  // Added before circuit relay to ensure direct is attempted first
  if (mergedConfig.enableWebRTC) {
    transports.push(
      webRTC({
        rtcConfiguration: {
          iceServers: mergedConfig.iceServers,
        },
      }) as unknown as () => Transport
    );
  }

  // Circuit relay transport for NAT traversal
  // Added last as it's the fallback when direct connections fail
  if (mergedConfig.enableCircuitRelay) {
    transports.push(
      circuitRelayTransport() as unknown as () => Transport
    );
  }

  return transports;
}

/**
 * Determines the appropriate transport type for a given multiaddr
 * 
 * @param multiaddr - The multiaddr string to analyze
 * @returns The transport type or null if unknown
 */
export function getTransportType(multiaddr: string): 'webrtc' | 'websocket' | 'relay' | null {
  if (multiaddr.includes('/p2p-circuit/')) {
    return 'relay';
  }
  if (multiaddr.includes('/webrtc/') || multiaddr.includes('/webrtc-direct/')) {
    return 'webrtc';
  }
  if (multiaddr.includes('/ws/') || multiaddr.includes('/wss/') || multiaddr.includes('/websocket/')) {
    return 'websocket';
  }
  return null;
}

/**
 * Sorts multiaddrs to prioritize direct connections over relay
 * 
 * Order:
 * 1. WebRTC (direct browser-to-browser)
 * 2. WebSocket (direct to server)
 * 3. Circuit Relay (fallback)
 * 
 * @param multiaddrs - Array of multiaddr strings
 * @returns Sorted array with direct connections first
 */
export function sortMultiaddrsByPriority(multiaddrs: string[]): string[] {
  const priority: Record<string, number> = {
    webrtc: 0,
    websocket: 1,
    relay: 2,
  };

  return [...multiaddrs].sort((a, b) => {
    const typeA = getTransportType(a);
    const typeB = getTransportType(b);
    
    const priorityA = typeA ? priority[typeA] : 3;
    const priorityB = typeB ? priority[typeB] : 3;
    
    return priorityA - priorityB;
  });
}

/**
 * Filters multiaddrs to only include browser-compatible transports
 * 
 * @param multiaddrs - Array of multiaddr strings
 * @returns Filtered array with only browser-compatible addresses
 */
export function filterBrowserCompatibleAddrs(multiaddrs: string[]): string[] {
  return multiaddrs.filter(addr => {
    // TCP is not available in browsers
    if (addr.includes('/tcp/') && !addr.includes('/ws/') && !addr.includes('/wss/')) {
      return false;
    }
    // Include WebSocket, WebRTC, and circuit relay addresses
    return (
      addr.includes('/ws/') ||
      addr.includes('/wss/') ||
      addr.includes('/websocket/') ||
      addr.includes('/webrtc/') ||
      addr.includes('/webrtc-direct/') ||
      addr.includes('/p2p-circuit/')
    );
  });
}

/**
 * Creates a connection dialer that enforces the connection strategy
 * (direct before relay)
 * 
 * @param tracker - Connection strategy tracker for recording attempts
 * @returns A dial function wrapper
 */
export function createStrategyEnforcingDialer(
  tracker: ConnectionStrategyTracker
) {
  return {
    /**
     * Prepare multiaddrs for dialing by sorting them according to strategy
     * and recording the attempt order
     */
    prepareForDial(peerId: string, multiaddrs: string[]): string[] {
      // Filter to browser-compatible addresses
      const compatible = filterBrowserCompatibleAddrs(multiaddrs);
      
      // Sort by priority (direct before relay)
      const sorted = sortMultiaddrsByPriority(compatible);
      
      return sorted;
    },

    /**
     * Record a connection attempt result
     */
    recordResult(
      peerId: string,
      multiaddr: string,
      success: boolean,
      error?: string
    ): void {
      const transport = getTransportType(multiaddr);
      if (transport) {
        tracker.recordAttempt({
          peerId,
          transport,
          success,
          error,
        });
      }
    },
  };
}
