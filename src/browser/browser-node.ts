/**
 * Browser Node - Full libp2p DHT node for browser environments
 * 
 * Enables browsers to participate as full DHT peers using:
 * - WebSocket transport for server connections
 * - WebRTC transport for browser-to-browser connections
 * - Circuit relay for NAT traversal
 * 
 * Integrates:
 * - PeerIdManager for identity management
 * - ActivityMonitor for tab visibility handling
 * - RelaySelector for relay node selection
 * - OverlayNetwork for encrypted messaging
 * 
 * Requirements: 1.1, 1.5, 1.6, 1.7, 4.1, 4.2, 5.1, 5.2, 5.3, 5.4, 5.5, 8.1, 8.2
 */

import { createLibp2p, type Libp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { kadDHT } from '@libp2p/kad-dht';
import { identify } from '@libp2p/identify';
import { ping } from '@libp2p/ping';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { webRTC } from '@libp2p/webrtc';
import { multiaddr, type Multiaddr } from '@multiformats/multiaddr';
import type { PeerId, Connection } from '@libp2p/interface';
import { peerIdFromString } from '@libp2p/peer-id';

import type { 
  BrowserNodeConfig, 
  BrowserNodeState, 
  BrowserConfigResponse,
  RelayNodeInfo,
} from './types.js';
import { DEFAULT_BROWSER_NODE_CONFIG } from './types.js';
import { PeerIdManager } from './peer-id-manager.js';
import { ActivityMonitor } from './activity-monitor.js';
import { RelaySelector } from './relay-selector.js';
import { ConnectionUpgrader, type ConnectionUpgraderConfig } from './connection-upgrader.js';
import { DEFAULT_ICE_SERVERS } from './transport-config.js';
import { OverlayNetwork, type MessageHandler as OverlayMessageHandler, type MessageContext as OverlayMessageContext } from '../overlay/index.js';
import { webSocketsWithHttpPath } from './websocket-transport.js';

/**
 * Check if a browser can dial the given multiaddr.
 * 
 * Browsers can only dial:
 * - WSS addresses (WebSocket Secure)
 * - WebRTC addresses
 * - Circuit relay addresses
 * 
 * And cannot dial:
 * - Private IP ranges (172.x.x.x, 10.x.x.x, 192.168.x.x)
 * - Localhost addresses
 * - Docker internal DNS names
 * - Plain TCP addresses
 * 
 * @param addr - Multiaddr string to check
 * @returns true if a browser can dial this address
 */
export function canDialAddress(addr: string): boolean {
  // Check for private/internal addresses
  const privatePatterns = [
    /\/ip4\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
    /\/ip4\/172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}/,
    /\/ip4\/192\.168\.\d{1,3}\.\d{1,3}/,
    /\/ip4\/127\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
    /\/dns4\/localhost\//,
    /\/dns\/localhost\//,
    /\/dns4\/libp2p-bootstrap\//,
    /\/dns4\/dht-node-\d+\//,
  ];
  
  for (const pattern of privatePatterns) {
    if (pattern.test(addr)) {
      return false;
    }
  }
  
  // Check for dialable transports
  const hasWss = addr.includes('/wss/') || addr.endsWith('/wss');
  const hasWebRTC = addr.includes('/webrtc/') || addr.includes('/webrtc-direct/');
  const hasCircuitRelay = addr.includes('/p2p-circuit/') || addr.includes('/p2p-circuit');
  
  return hasWss || hasWebRTC || hasCircuitRelay;
}

/**
 * Filter a list of multiaddrs to only those dialable by browsers.
 * 
 * @param addrs - Array of multiaddr strings
 * @returns Array of dialable addresses
 */
export function filterDialableAddresses(addrs: string[]): string[] {
  return addrs.filter(canDialAddress);
}

/**
 * State change callback type
 */
export type StateChangeCallback = (state: BrowserNodeState) => void;

/**
 * Message context for incoming messages
 */
export interface MessageContext {
  originPeerId: string;
  messageId: string;
}

/**
 * Message handler type
 */
export type MessageHandler = (payload: Uint8Array, context: MessageContext) => Promise<Uint8Array>;

/**
 * Peer info returned from DHT operations
 */
export interface PeerInfo {
  id: string;
  multiaddrs: string[];
}

/**
 * Browser DHT Adapter - Wraps browser libp2p instance to be compatible with OverlayNetwork
 * 
 * This adapter provides the DHTNode-like interface that OverlayNetwork expects,
 * but uses the browser's libp2p instance instead of a full DHTNode.
 * 
 * Requirements: 5.1
 */
export class BrowserDHTAdapter {
  private readonly libp2p: Libp2p;
  private readonly _peerId: PeerId;

  constructor(libp2p: Libp2p) {
    this.libp2p = libp2p;
    this._peerId = libp2p.peerId;
  }

  /**
   * Get the peer ID of this node
   */
  get peerId(): PeerId {
    return this._peerId;
  }

  /**
   * Check if the node is started
   */
  get isStarted(): boolean {
    return this.libp2p.status === 'started';
  }

  /**
   * Get the underlying libp2p node
   */
  getLibp2pNode(): Libp2p {
    return this.libp2p;
  }

  /**
   * Store a key-value pair in the DHT
   */
  async put(key: Uint8Array, value: Uint8Array): Promise<void> {
    const dht = this.getDHTService();
    await dht.put(key, value);
  }

  /**
   * Retrieve a value from the DHT
   */
  async get(key: Uint8Array): Promise<Uint8Array> {
    const dht = this.getDHTService();
    
    for await (const event of dht.get(key)) {
      if (event.name === 'VALUE') {
        return event.value;
      }
    }
    
    throw new Error('Key not found in DHT');
  }

  /**
   * Get the closest peers to a key
   */
  async *getClosestPeers(key: Uint8Array): AsyncIterable<{ id: PeerId; multiaddrs: Multiaddr[] }> {
    const dht = this.getDHTService();
    const seen = new Set<string>();
    
    for await (const event of dht.getClosestPeers(key)) {
      if (event.name === 'PEER_RESPONSE') {
        for (const peer of event.closer) {
          const peerId = peer.id.toString();
          if (!seen.has(peerId)) {
            seen.add(peerId);
            yield {
              id: peer.id,
              multiaddrs: peer.multiaddrs,
            };
          }
        }
      }
      if (event.name === 'FINAL_PEER') {
        const peerId = event.peer.id.toString();
        if (!seen.has(peerId)) {
          seen.add(peerId);
          yield {
            id: event.peer.id,
            multiaddrs: event.peer.multiaddrs,
          };
        }
      }
    }
  }

  /**
   * Find a specific peer in the network
   */
  async findPeer(peerId: string): Promise<{ id: PeerId; multiaddrs: Multiaddr[] } | null> {
    const dht = this.getDHTService();
    const targetPeerId = peerIdFromString(peerId);
    
    try {
      for await (const event of dht.findPeer(targetPeerId)) {
        if (event.name === 'FINAL_PEER') {
          return {
            id: event.peer.id,
            multiaddrs: event.peer.multiaddrs,
          };
        }
      }
    } catch {
      // Peer not found
    }
    
    return null;
  }

  /**
   * Get the DHT service from libp2p
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getDHTService(): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const services = (this.libp2p as any).services;
    if (!services?.dht) {
      throw new Error('DHT service is not available');
    }
    return services.dht;
  }
}

/**
 * Browser-native libp2p DHT node
 * 
 * Provides full DHT participation from browser environments with:
 * - Automatic peer ID management (persistent or ephemeral)
 * - Activity monitoring for tab visibility
 * - Relay selection for NAT traversal
 * - Connection limit enforcement
 */
export class BrowserNode {
  private config: Required<BrowserNodeConfig>;
  private libp2p: Libp2p | null = null;
  private peerIdManager: PeerIdManager;
  private activityMonitor: ActivityMonitor;
  private relaySelector: RelaySelector;
  private connectionUpgrader: ConnectionUpgrader;
  private overlayNetwork: OverlayNetwork | null = null;
  private dhtAdapter: BrowserDHTAdapter | null = null;
  
  private state: BrowserNodeState;
  private stateCallbacks: StateChangeCallback[] = [];
  private messageHandler: MessageHandler | null = null;
  
  private connectionPruneTimer: ReturnType<typeof setInterval> | null = null;
  private bytesIn = 0;
  private bytesOut = 0;

  /**
   * Create a new BrowserNode instance
   * 
   * @param config - Browser node configuration
   */
  constructor(config: Partial<BrowserNodeConfig> & Pick<BrowserNodeConfig, 'bootstrapUrls' | 'peerIdMode'>) {
    this.config = {
      ...DEFAULT_BROWSER_NODE_CONFIG,
      ...config,
    } as Required<BrowserNodeConfig>;

    // Initialize peer ID manager
    this.peerIdManager = new PeerIdManager({
      mode: this.config.peerIdMode,
      storageKey: 'primary',
    });

    // Initialize activity monitor
    this.activityMonitor = new ActivityMonitor({
      disconnectOnInactive: true,
      reconnectOnActive: true,
      inactivityGracePeriod: 5000,
    });

    // Initialize relay selector
    this.relaySelector = new RelaySelector({
      maxUtilizationThreshold: 0.95,
      statusCacheTTL: 30000,
      maxRetryAttempts: 3,
    });

    // Initialize connection upgrader for periodic direct connection retry
    // Requirements: 3.4, 10.6
    this.connectionUpgrader = new ConnectionUpgrader({
      upgradeInterval: 60000, // 1 minute
      maxUpgradeAttempts: 10,
      enabled: true,
    });

    // Initialize state
    this.state = {
      status: 'disconnected',
      peerId: null,
      connectedPeers: 0,
      browserPeers: 0,
      serverPeers: 0,
      routingTableSize: 0,
      bytesIn: 0,
      bytesOut: 0,
    };
  }

  /**
   * Start the browser node
   * 
   * Initializes libp2p, connects to bootstrap nodes, and joins the DHT.
   * 
   * Requirements: 1.1, 1.5, 1.6
   */
  async start(): Promise<void> {
    if (this.libp2p) {
      return; // Already started
    }

    this.updateState({ status: 'connecting' });

    try {
      // Get or generate peer ID
      const peerId = await this.peerIdManager.getPeerId();
      const privateKey = this.peerIdManager.getPrivateKey();

      if (!privateKey) {
        throw new Error('Failed to get private key from PeerIdManager');
      }

      // Create libp2p node with browser transports
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.libp2p = await createLibp2p({
        privateKey,
        transports: [
          // Use custom WebSocket transport that supports http-path for nginx routing
          webSocketsWithHttpPath() as any,
          webRTC({
            rtcConfiguration: {
              iceServers: DEFAULT_ICE_SERVERS,
            },
          }) as any,
          circuitRelayTransport() as any,
        ],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        services: {
          identify: identify(),
          ping: ping(),
          dht: kadDHT({
            clientMode: false, // Full DHT participation
          }) as any,
        },
        connectionManager: {
          maxConnections: this.config.maxConnections,
        },
      });

      // Set up event listeners
      this.setupEventListeners();

      // Start libp2p
      await this.libp2p.start();

      // Update state with peer ID
      this.updateState({
        status: 'connected',
        peerId: peerId.toString(),
      });

      // Bootstrap to server nodes
      await this.bootstrap();

      // Initialize overlay network if enabled
      // Requirements: 5.1, 5.2
      if (this.config.enableOverlay) {
        await this.initializeOverlay();
      }

      // Start activity monitoring
      this.setupActivityMonitoring();

      // Start connection pruning
      this.startConnectionPruning();

      // Initialize and start connection upgrader
      // Requirements: 3.4, 10.6
      this.initializeConnectionUpgrader();

    } catch (error) {
      this.updateState({ status: 'disconnected' });
      throw error;
    }
  }

  /**
   * Stop the browser node
   * 
   * Gracefully disconnects from all peers and releases resources.
   * 
   * Requirements: 1.7
   */
  async stop(): Promise<void> {
    if (!this.libp2p) {
      return; // Already stopped
    }

    // Stop connection pruning
    if (this.connectionPruneTimer) {
      clearInterval(this.connectionPruneTimer);
      this.connectionPruneTimer = null;
    }

    // Stop connection upgrader
    // Requirements: 3.4, 10.6
    this.connectionUpgrader.stop();
    this.connectionUpgrader.clear();

    // Stop activity monitoring
    this.activityMonitor.stop();

    // Stop overlay network
    // Requirements: 5.1
    if (this.overlayNetwork) {
      await this.overlayNetwork.stop();
      this.overlayNetwork = null;
      this.dhtAdapter = null;
    }

    // Close all connections gracefully
    const connections = this.libp2p.getConnections();
    await Promise.all(
      connections.map(conn => conn.close().catch(() => {}))
    );

    // Stop libp2p
    await this.libp2p.stop();
    this.libp2p = null;

    // Update state
    this.updateState({
      status: 'disconnected',
      connectedPeers: 0,
      browserPeers: 0,
      serverPeers: 0,
      routingTableSize: 0,
    });
  }

  /**
   * Get current node state
   */
  getState(): BrowserNodeState {
    return { ...this.state };
  }

  /**
   * Register a callback for state changes
   * 
   * @param callback - Function to call when state changes
   * @returns Unsubscribe function
   */
  onStateChange(callback: StateChangeCallback): () => void {
    this.stateCallbacks.push(callback);
    return () => {
      const index = this.stateCallbacks.indexOf(callback);
      if (index !== -1) {
        this.stateCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Store a key-value pair in the DHT
   * 
   * Requirements: 4.1
   * 
   * @param key - The key to store under
   * @param value - The value to store
   */
  async put(key: Uint8Array, value: Uint8Array): Promise<void> {
    this.ensureStarted();
    
    const dht = this.getDHTService();
    await dht.put(key, value);
    
    this.bytesOut += key.length + value.length;
    this.updateState({ bytesOut: this.bytesOut });
  }

  /**
   * Retrieve a value from the DHT
   * 
   * Requirements: 4.2
   * 
   * @param key - The key to retrieve
   * @returns The stored value
   */
  async get(key: Uint8Array): Promise<Uint8Array> {
    this.ensureStarted();
    
    const dht = this.getDHTService();
    
    for await (const event of dht.get(key)) {
      if (event.name === 'VALUE') {
        this.bytesIn += event.value.length;
        this.updateState({ bytesIn: this.bytesIn });
        return event.value;
      }
    }
    
    throw new Error('Key not found in DHT');
  }

  /**
   * Get the closest peers to a key
   * 
   * Filters returned addresses to only include those dialable by browsers.
   * 
   * @param key - The key to find closest peers for
   * @yields PeerInfo for each peer found (with filtered addresses)
   */
  async *getClosestPeers(key: Uint8Array): AsyncIterable<PeerInfo> {
    this.ensureStarted();
    
    const dht = this.getDHTService();
    const seen = new Set<string>();
    
    for await (const event of dht.getClosestPeers(key)) {
      if (event.name === 'PEER_RESPONSE') {
        for (const peer of event.closer) {
          const peerId = peer.id.toString();
          if (!seen.has(peerId)) {
            seen.add(peerId);
            // Filter addresses to only those dialable by browsers
            const allAddrs = peer.multiaddrs.map((ma: { toString: () => string }) => ma.toString());
            const dialableAddrs = filterDialableAddresses(allAddrs);
            yield {
              id: peerId,
              multiaddrs: dialableAddrs,
            };
          }
        }
      }
      if (event.name === 'FINAL_PEER') {
        const peerId = event.peer.id.toString();
        if (!seen.has(peerId)) {
          seen.add(peerId);
          // Filter addresses to only those dialable by browsers
          const allAddrs = event.peer.multiaddrs.map((ma: { toString: () => string }) => ma.toString());
          const dialableAddrs = filterDialableAddresses(allAddrs);
          yield {
            id: peerId,
            multiaddrs: dialableAddrs,
          };
        }
      }
    }
  }

  /**
   * Send an encrypted message to a target peer via the overlay network
   * 
   * Requirements: 5.3, 5.4
   * 
   * @param targetPeerId - The peer ID of the target node
   * @param payload - The message payload to send
   * @returns The response payload from the target
   */
  async sendMessage(targetPeerId: string, payload: Uint8Array): Promise<Uint8Array> {
    this.ensureStarted();
    
    if (!this.overlayNetwork) {
      throw new Error('Overlay network is not enabled. Set enableOverlay: true in config.');
    }
    
    return this.overlayNetwork.sendMessage(targetPeerId, payload);
  }

  /**
   * Register a message handler for incoming overlay messages
   * 
   * Requirements: 5.4, 5.5
   * 
   * @param handler - Function to handle incoming messages
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
    
    // If overlay network is already initialized, register the handler
    if (this.overlayNetwork) {
      this.overlayNetwork.onMessage((payload: Uint8Array, context: OverlayMessageContext) => {
        return handler(payload, {
          originPeerId: context.originPeerId,
          messageId: context.messageId,
        });
      });
    }
  }

  /**
   * Get the underlying libp2p node (for advanced use)
   */
  getLibp2pNode(): Libp2p {
    this.ensureStarted();
    return this.libp2p!;
  }

  /**
   * Get the peer ID of this node
   */
  getPeerId(): string | null {
    return this.state.peerId;
  }

  /**
   * Get the number of active connections
   */
  getConnectionCount(): number {
    if (!this.libp2p) return 0;
    return this.libp2p.getConnections().length;
  }

  /**
   * Check if connection limit is reached
   */
  isAtConnectionLimit(): boolean {
    return this.getConnectionCount() >= this.config.maxConnections;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Bootstrap to server nodes
   */
  private async bootstrap(): Promise<void> {
    if (!this.libp2p || this.config.bootstrapUrls.length === 0) {
      return;
    }

    const errors: Error[] = [];
    let connectedCount = 0;

    for (const url of this.config.bootstrapUrls) {
      try {
        console.log(`[BrowserNode] Attempting to connect to bootstrap: ${url}`);
        const ma = multiaddr(url);
        console.log(`[BrowserNode] Parsed multiaddr: ${ma.toString()}`);
        await this.libp2p.dial(ma);
        console.log(`[BrowserNode] Successfully connected to: ${url}`);
        connectedCount++;
      } catch (error) {
        console.error(`[BrowserNode] Failed to connect to ${url}:`, error);
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    if (connectedCount === 0 && this.config.bootstrapUrls.length > 0) {
      throw new Error(`Failed to connect to any bootstrap peers. Attempted ${this.config.bootstrapUrls.length} peer(s).`);
    }
  }

  /**
   * Set up libp2p event listeners
   */
  private setupEventListeners(): void {
    if (!this.libp2p) return;

    this.libp2p.addEventListener('peer:connect', (event) => {
      this.updateConnectionCounts();
      
      // Track relayed connections for potential upgrade
      // Requirements: 3.4, 10.6
      this.trackNewConnection(event.detail);
    });

    this.libp2p.addEventListener('peer:disconnect', (event) => {
      this.updateConnectionCounts();
      
      // Untrack disconnected peer from connection upgrader
      const peerId = event.detail.toString();
      this.connectionUpgrader.untrackConnection(peerId);
    });
  }

  /**
   * Track a new connection for potential upgrade if it's relayed
   * 
   * Requirements: 3.4, 10.6
   */
  private trackNewConnection(remotePeer: PeerId): void {
    if (!this.libp2p) return;

    const peerId = remotePeer.toString();
    const connections = this.libp2p.getConnections(remotePeer);
    
    for (const conn of connections) {
      const remoteAddr = conn.remoteAddr.toString();
      
      // Check if this is a relayed connection
      if (remoteAddr.includes('/p2p-circuit/')) {
        // Get any known direct addresses for this peer
        const directAddrs: string[] = [];
        
        // Track for potential upgrade
        this.connectionUpgrader.trackRelayedConnection(
          peerId,
          conn.id,
          directAddrs
        );
        break; // Only track once per peer
      }
    }
  }

  /**
   * Update connection counts in state
   */
  private updateConnectionCounts(): void {
    if (!this.libp2p) return;

    const connections = this.libp2p.getConnections();
    let browserPeers = 0;
    let serverPeers = 0;

    for (const conn of connections) {
      const remoteAddr = conn.remoteAddr.toString();
      if (remoteAddr.includes('/webrtc/') || remoteAddr.includes('/p2p-circuit/')) {
        browserPeers++;
      } else {
        serverPeers++;
      }
    }

    this.updateState({
      connectedPeers: connections.length,
      browserPeers,
      serverPeers,
    });
  }

  /**
   * Set up activity monitoring for tab visibility
   */
  private setupActivityMonitoring(): void {
    this.activityMonitor.onInactive(() => {
      this.handleInactive();
    });

    this.activityMonitor.onActive(() => {
      this.handleActive();
    });

    this.activityMonitor.onNetworkOffline(() => {
      this.handleInactive();
    });

    this.activityMonitor.onNetworkOnline(() => {
      this.handleActive();
    });

    this.activityMonitor.start();
  }

  /**
   * Handle tab becoming inactive
   * 
   * Requirements: 8.4
   */
  private async handleInactive(): Promise<void> {
    if (!this.libp2p || this.state.status === 'inactive') return;

    // Close all connections to prevent stale routing entries
    const connections = this.libp2p.getConnections();
    await Promise.all(
      connections.map(conn => conn.close().catch(() => {}))
    );

    this.updateState({
      status: 'inactive',
      connectedPeers: 0,
      browserPeers: 0,
      serverPeers: 0,
    });
  }

  /**
   * Handle tab becoming active
   * 
   * Requirements: 8.5
   */
  private async handleActive(): Promise<void> {
    if (!this.libp2p || this.state.status !== 'inactive') return;

    this.updateState({ status: 'connecting' });

    try {
      // Reconnect to bootstrap nodes
      await this.bootstrap();
      this.updateState({ status: 'connected' });
    } catch (error) {
      console.error('Failed to reconnect:', error);
      this.updateState({ status: 'disconnected' });
    }
  }

  /**
   * Start connection pruning to enforce limits
   * 
   * Requirements: 8.1, 8.2
   */
  private startConnectionPruning(): void {
    // Check every 30 seconds
    this.connectionPruneTimer = setInterval(() => {
      this.pruneConnections();
    }, 30000);
  }

  /**
   * Prune connections when approaching limit
   * 
   * Requirements: 8.2
   */
  private pruneConnections(): void {
    if (!this.libp2p) return;

    const connections = this.libp2p.getConnections();
    const limit = this.config.maxConnections;
    
    // Start pruning when at 90% capacity
    if (connections.length < limit * 0.9) return;

    // Sort by last activity (oldest first)
    const sortedConnections = [...connections].sort((a, b) => {
      const timeA = a.timeline.open;
      const timeB = b.timeline.open;
      return timeA - timeB;
    });

    // Close oldest connections to get back to 80% capacity
    const targetCount = Math.floor(limit * 0.8);
    const toClose = sortedConnections.slice(0, connections.length - targetCount);

    for (const conn of toClose) {
      conn.close().catch(() => {});
    }
  }

  /**
   * Initialize the connection upgrader for periodic direct connection retry
   * 
   * Requirements: 3.4, 10.6
   */
  private initializeConnectionUpgrader(): void {
    if (!this.libp2p) return;

    // Initialize with libp2p functions
    this.connectionUpgrader.initialize(
      // Dial function
      (multiaddr) => this.libp2p!.dial(multiaddr as any),
      // Peer store
      this.libp2p.peerStore as any,
      // Get connections function
      () => this.libp2p!.getConnections()
    );

    // Start the periodic upgrade timer
    this.connectionUpgrader.start();

    // Track any existing relayed connections
    const connections = this.libp2p.getConnections();
    for (const conn of connections) {
      const remoteAddr = conn.remoteAddr.toString();
      if (remoteAddr.includes('/p2p-circuit/')) {
        this.connectionUpgrader.trackRelayedConnection(
          conn.remotePeer.toString(),
          conn.id,
          []
        );
      }
    }
  }

  /**
   * Get the connection upgrader instance (for advanced use)
   * 
   * @returns The connection upgrader instance
   */
  getConnectionUpgrader(): ConnectionUpgrader {
    return this.connectionUpgrader;
  }

  /**
   * Initialize the overlay network
   * 
   * Requirements: 5.1, 5.2
   */
  private async initializeOverlay(): Promise<void> {
    if (!this.libp2p) {
      throw new Error('libp2p must be started before initializing overlay');
    }

    // Create DHT adapter for the overlay network
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.dhtAdapter = new BrowserDHTAdapter(this.libp2p as any);

    // Create overlay network with the DHT adapter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.overlayNetwork = new OverlayNetwork(this.dhtAdapter as any);

    // Start the overlay network (this publishes public key to DHT)
    await this.overlayNetwork.start();

    // Register message handler if one was set before start
    if (this.messageHandler) {
      const handler = this.messageHandler;
      this.overlayNetwork.onMessage((payload: Uint8Array, context: OverlayMessageContext) => {
        return handler(payload, {
          originPeerId: context.originPeerId,
          messageId: context.messageId,
        });
      });
    }
  }

  /**
   * Get the overlay network instance (for advanced use)
   * 
   * @returns The overlay network instance or null if not enabled
   */
  getOverlayNetwork(): OverlayNetwork | null {
    return this.overlayNetwork;
  }

  /**
   * Update state and notify callbacks
   */
  private updateState(partial: Partial<BrowserNodeState>): void {
    this.state = { ...this.state, ...partial };
    
    for (const callback of this.stateCallbacks) {
      try {
        callback(this.state);
      } catch (error) {
        console.error('State change callback error:', error);
      }
    }
  }

  /**
   * Ensure the node is started
   */
  private ensureStarted(): void {
    if (!this.libp2p) {
      throw new Error('BrowserNode is not started. Call start() first.');
    }
  }

  /**
   * Get the DHT service from libp2p
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getDHTService(): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const services = (this.libp2p as any).services;
    if (!services?.dht) {
      throw new Error('DHT service is not available');
    }
    return services.dht;
  }
}

/**
 * Fetch browser configuration from server
 * 
 * @param serverUrl - Base URL of the server
 * @returns Browser configuration
 */
export async function fetchBrowserConfig(serverUrl: string): Promise<BrowserConfigResponse> {
  const response = await fetch(`${serverUrl}/browser/config`);
  if (!response.ok) {
    throw new Error(`Failed to fetch browser config: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Create a BrowserNode from server configuration
 * 
 * @param serverUrl - Base URL of the server to fetch config from
 * @returns Configured BrowserNode instance
 */
export async function createBrowserNodeFromConfig(serverUrl: string): Promise<BrowserNode> {
  const config = await fetchBrowserConfig(serverUrl);
  
  return new BrowserNode({
    bootstrapUrls: config.bootstrapPeers,
    peerIdMode: config.peerIdMode,
    maxConnections: config.maxConnections,
    enableCircuitRelay: true,
    enableDHT: config.dhtEnabled,
    enableOverlay: config.overlayEnabled,
  });
}
