/**
 * Browser-native libp2p node types
 */

/**
 * Configuration for browser node initialization
 */
export interface BrowserNodeConfig {
  /** Server bootstrap WebSocket URLs */
  bootstrapUrls: string[];
  /** Peer ID persistence mode */
  peerIdMode: 'persistent' | 'ephemeral';
  /** Maximum concurrent connections (default: 50) */
  maxConnections: number;
  /** Enable circuit relay for NAT traversal (default: true) */
  enableCircuitRelay: boolean;
  /** Enable DHT participation (default: true) */
  enableDHT: boolean;
  /** Enable overlay messaging (default: true) */
  enableOverlay: boolean;
}

/**
 * Current state of a browser node
 */
export interface BrowserNodeState {
  /** Connection status */
  status: 'disconnected' | 'connecting' | 'connected' | 'inactive';
  /** Local peer ID (null if not started) */
  peerId: string | null;
  /** Total number of connected peers */
  connectedPeers: number;
  /** Peers connected via WebRTC */
  browserPeers: number;
  /** Peers connected via WebSocket */
  serverPeers: number;
  /** Number of entries in DHT routing table */
  routingTableSize: number;
  /** Total bytes received */
  bytesIn: number;
  /** Total bytes sent */
  bytesOut: number;
}

/**
 * Information about a relay node
 */
export interface RelayNodeInfo {
  /** Peer ID of the relay node */
  peerId: string;
  /** Multiaddrs of the relay node */
  multiaddrs: string[];
  /** Current utilization (0-1) */
  utilization: number;
  /** Timestamp of last status update */
  lastUpdated: number;
}

/**
 * Relay status response from server
 */
export interface RelayStatus {
  /** Number of active reservations */
  activeReservations: number;
  /** Maximum allowed reservations */
  maxReservations: number;
  /** Number of active circuits */
  activeCircuits: number;
  /** Maximum circuits per peer */
  maxCircuits: number;
}

/**
 * Browser configuration response from server
 */
export interface BrowserConfigResponse {
  /** Peer ID persistence mode */
  peerIdMode: 'persistent' | 'ephemeral';
  /** Multiaddrs of bootstrap nodes */
  bootstrapPeers: string[];
  /** Multiaddrs of circuit relay nodes */
  relayNodes: string[];
  /** Maximum connections for browser nodes */
  maxConnections: number;
  /** Whether DHT is enabled */
  dhtEnabled: boolean;
  /** Whether overlay messaging is enabled */
  overlayEnabled: boolean;
}

/**
 * Configuration for activity monitoring
 */
export interface ActivityMonitorConfig {
  /** Disconnect when tab becomes inactive (default: true) */
  disconnectOnInactive: boolean;
  /** Reconnect when tab becomes active (default: true) */
  reconnectOnActive: boolean;
  /** Grace period in ms before disconnect (default: 5000) */
  inactivityGracePeriod: number;
}

/**
 * Configuration for peer ID management
 */
export interface PeerIdManagerConfig {
  /** Persistence mode */
  mode: 'persistent' | 'ephemeral';
  /** IndexedDB key for persistent mode */
  storageKey: string;
}

/**
 * Stored identity in IndexedDB
 */
export interface StoredIdentity {
  /** Primary key */
  id: 'primary';
  /** Ed25519 private key bytes */
  privateKey: Uint8Array;
  /** Peer ID string */
  peerId: string;
  /** Creation timestamp */
  createdAt: number;
}

/**
 * Stored peer information in IndexedDB
 */
export interface StoredPeer {
  /** Peer ID */
  peerId: string;
  /** Known multiaddrs */
  multiaddrs: string[];
  /** Last seen timestamp */
  lastSeen: number;
  /** Connection type used */
  connectionType: 'webrtc' | 'websocket' | 'relay';
}

/**
 * Stored DHT record in IndexedDB
 */
export interface StoredDHTRecord {
  /** Base64 encoded key */
  key: string;
  /** Record value */
  value: Uint8Array;
  /** Expiry timestamp */
  expiry: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_BROWSER_NODE_CONFIG: Partial<BrowserNodeConfig> = {
  maxConnections: 50,
  enableCircuitRelay: true,
  enableDHT: true,
  enableOverlay: true,
};

/**
 * Default activity monitor configuration
 */
export const DEFAULT_ACTIVITY_MONITOR_CONFIG: ActivityMonitorConfig = {
  disconnectOnInactive: true,
  reconnectOnActive: true,
  inactivityGracePeriod: 5000,
};
