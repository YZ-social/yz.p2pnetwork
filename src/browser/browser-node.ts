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
import { identify, identifyPush } from '@libp2p/identify';
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
  private peerDiscoveryTimer: ReturnType<typeof setInterval> | null = null;
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
        addresses: {
          listen: [
            // Listen on circuit relay to get a reservation and become dialable via relay
            // This is REQUIRED for browser-to-browser connectivity
            '/p2p-circuit',
            // Listen for incoming WebRTC connections
            // This enables direct browser-to-browser connections after relay signaling
            '/webrtc',
          ],
        },
        transports: [
          // Use custom WebSocket transport that supports http-path for nginx routing
          webSocketsWithHttpPath() as any,
          webRTC({
            rtcConfiguration: {
              iceServers: DEFAULT_ICE_SERVERS,
            },
          }) as any,
          // Circuit relay transport - relay discovery is automatic when listening on /p2p-circuit
          // The RelayDiscovery class automatically discovers and makes reservations on
          // connected peers that support the circuit v2 HOP protocol
          circuitRelayTransport() as any,
        ],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        services: {
          identify: identify(),
          // identifyPush pushes address updates to connected peers when our addresses change
          // This is critical for relay reservations - when we get a relay address,
          // we need to tell our peers so they can update their peer store
          identifyPush: identifyPush({
            runOnSelfUpdate: true, // Push when our addresses change
          }),
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

      // Capture reservation store reference AFTER start (transports are now initialized)
      this.captureReservationStoreReference();

      // Log the listen addresses after start
      console.log('[BrowserNode] 🚀 libp2p started');
      console.log('[BrowserNode] 📍 Listen addresses configured:', this.libp2p.getMultiaddrs().map(ma => ma.toString()));
      
      // Check if we're listening on /p2p-circuit
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const libp2pAny = this.libp2p as any;
      if (libp2pAny.components?.transportManager?.listeners) {
        const listeners = libp2pAny.components.transportManager.listeners;
        console.log(`[BrowserNode] 🎧 Active listeners: ${listeners.size}`);
        for (const [key, listener] of listeners) {
          const addrs = listener.getAddrs?.() || [];
          console.log(`[BrowserNode]   Listener ${key}: ${addrs.length} addresses`);
          for (const addr of addrs) {
            console.log(`[BrowserNode]     ${addr.toString()}`);
          }
        }
      }
      
      // Check the circuit relay transport's reservation store
      if (libp2pAny.components?.transportManager?.transports) {
        const transports = libp2pAny.components.transportManager.transports;
        for (const [name, transport] of transports) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const t = transport as any;
          if (t.reservationStore) {
            console.log(`[BrowserNode] 📋 Circuit relay transport reservation store:`);
            console.log(`[BrowserNode]   Pending reservations: ${t.reservationStore.pendingReservations?.length || 0}`);
            console.log(`[BrowserNode]   Current reservations: ${t.reservationStore.reservations?.size || 0}`);
            
            // Log the actual pending reservation IDs
            if (t.reservationStore.pendingReservations?.length > 0) {
              console.log(`[BrowserNode]   Pending IDs: ${t.reservationStore.pendingReservations.join(', ')}`);
            }
          }
          
          // Check discovery state
          if (t.discovery) {
            console.log(`[BrowserNode] 🔍 Relay discovery state:`);
            console.log(`[BrowserNode]   Started: ${t.discovery.started}`);
            console.log(`[BrowserNode]   Running: ${t.discovery.running}`);
            console.log(`[BrowserNode]   TopologyId: ${t.discovery.topologyId}`);
          }
        }
      }

      // Update state with peer ID
      this.updateState({
        status: 'connected',
        peerId: peerId.toString(),
      });

      // Bootstrap to server nodes
      await this.bootstrap();

      // Perform initial peer discovery to populate routing table
      await this.discoverPeers();

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

      // Start periodic peer discovery
      this.startPeriodicPeerDiscovery();

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

    // Stop peer discovery
    if (this.peerDiscoveryTimer) {
      clearInterval(this.peerDiscoveryTimer);
      this.peerDiscoveryTimer = null;
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
    
    console.log('[BrowserNode] DHT PUT starting...');
    console.log(`[BrowserNode] Connected peers: ${this.libp2p?.getConnections().length}`);
    
    // Log all events during PUT for debugging
    let putEventCount = 0;
    for await (const event of dht.put(key, value)) {
      putEventCount++;
      console.log(`[BrowserNode] PUT event ${putEventCount}: ${event.name}`, event);
    }
    
    console.log(`[BrowserNode] DHT PUT complete, ${putEventCount} events`);
    
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
    
    console.log('[BrowserNode] DHT GET starting...');
    console.log(`[BrowserNode] Connected peers: ${this.libp2p?.getConnections().length}`);
    
    // Log all events during GET for debugging
    let getEventCount = 0;
    for await (const event of dht.get(key)) {
      getEventCount++;
      console.log(`[BrowserNode] GET event ${getEventCount}: ${event.name}`, event);
      
      if (event.name === 'VALUE') {
        console.log(`[BrowserNode] DHT GET found value after ${getEventCount} events`);
        this.bytesIn += event.value.length;
        this.updateState({ bytesIn: this.bytesIn });
        return event.value;
      }
    }
    
    console.log(`[BrowserNode] DHT GET complete, ${getEventCount} events, no VALUE found`);
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
      const reason = this.config.enableOverlay 
        ? 'Overlay network failed to initialize. Check console for errors.'
        : 'Overlay network is not enabled. Set enableOverlay: true in config.';
      throw new Error(reason);
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
        
        // Log available transports
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const transports = (this.libp2p as any).components?.transportManager?.transports;
        if (transports) {
          console.log(`[BrowserNode] Available transports: ${transports.size}`);
          for (const [key, transport] of transports) {
            console.log(`[BrowserNode]   Transport: ${key}`);
            if (transport.dialFilter) {
              const filtered = transport.dialFilter([ma]);
              console.log(`[BrowserNode]   dialFilter result: ${filtered.length} addresses`);
              filtered.forEach((a: { toString: () => string }) => console.log(`[BrowserNode]     - ${a.toString()}`));
            }
          }
        }
        
        console.log(`[BrowserNode] Calling libp2p.dial()...`);
        const dialStartTime = Date.now();
        await this.libp2p.dial(ma);
        const dialDuration = Date.now() - dialStartTime;
        console.log(`[BrowserNode] Successfully connected to: ${url} (took ${dialDuration}ms)`);
        connectedCount++;
        
        // Log the protocols supported by the connected peer
        // Extract peer ID from the multiaddr components
        const components = ma.getComponents();
        const p2pComponent = components.find(c => c.name === 'p2p');
        const peerIdStr = p2pComponent?.value;
        if (peerIdStr) {
          try {
            const peerData = await this.libp2p.peerStore.get(peerIdFromString(peerIdStr));
            const protocols = peerData.protocols || [];
            console.log(`[BrowserNode] Bootstrap peer protocols (${protocols.length}):`);
            for (const proto of protocols) {
              if (proto.includes('circuit') || proto.includes('relay') || proto.includes('hop')) {
                console.log(`[BrowserNode]   🔌 ${proto}`);
              }
            }
            const hasHop = protocols.some(p => p.includes('/hop'));
            if (hasHop) {
              console.log(`[BrowserNode] ✅ Bootstrap supports HOP protocol - relay reservations should work`);
            } else {
              console.warn(`[BrowserNode] ⚠️ Bootstrap does NOT support HOP protocol - relay reservations will fail`);
            }
          } catch (e) {
            console.log(`[BrowserNode] Could not get peer protocols: ${e}`);
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorName = error instanceof Error ? error.name : 'Unknown';
        const errorStack = error instanceof Error ? error.stack : '';
        console.error(`[BrowserNode] Failed to connect to ${url}:`);
        console.error(`[BrowserNode]   Error name: ${errorName}`);
        console.error(`[BrowserNode]   Error message: ${errorMessage}`);
        console.error(`[BrowserNode]   Error stack: ${errorStack}`);
        // Log any additional error properties
        if (error && typeof error === 'object') {
          const errorObj = error as Record<string, unknown>;
          if (errorObj.code) console.error(`[BrowserNode]   Error code: ${errorObj.code}`);
          if (errorObj.cause) console.error(`[BrowserNode]   Error cause: ${errorObj.cause}`);
        }
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    if (connectedCount === 0 && this.config.bootstrapUrls.length > 0) {
      throw new Error(`Failed to connect to any bootstrap peers. Attempted ${this.config.bootstrapUrls.length} peer(s).`);
    }

    // Wait for relay reservation to be established
    // The relay reservation is asynchronous - we need to wait for addresses to appear
    if (this.libp2p && connectedCount > 0) {
      console.log('[BrowserNode] Waiting for relay reservation...');
      console.log('[BrowserNode] Connected to relay, waiting for identify exchange...');
      
      // Wait for addresses with timeout
      const maxWaitTime = 15000; // 15 seconds max (increased for identify + reservation)
      const checkInterval = 500; // Check every 500ms
      const startTime = Date.now();
      
      let hasRelayAddr = false;
      let hasWebRTCAddr = false;
      let lastAddrCount = 0;
      
      while (Date.now() - startTime < maxWaitTime) {
        const myAddrs = this.libp2p.getMultiaddrs();
        hasRelayAddr = myAddrs.some(a => a.toString().includes('/p2p-circuit'));
        hasWebRTCAddr = myAddrs.some(a => a.toString().includes('/webrtc'));
        
        // Log when address count changes
        if (myAddrs.length !== lastAddrCount) {
          console.log(`[BrowserNode] Address count changed: ${lastAddrCount} -> ${myAddrs.length}`);
          lastAddrCount = myAddrs.length;
        }
        
        if (hasRelayAddr || hasWebRTCAddr) {
          console.log(`[BrowserNode] Got relay/WebRTC addresses after ${Date.now() - startTime}ms`);
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }
      
      // Log final addresses
      const myAddrs = this.libp2p.getMultiaddrs();
      console.log(`[BrowserNode] Our multiaddrs after bootstrap (${myAddrs.length} total):`);
      for (const addr of myAddrs) {
        const addrStr = addr.toString();
        if (addrStr.includes('/p2p-circuit')) {
          console.log(`[BrowserNode]   📡 Relay address: ${addrStr}`);
        } else if (addrStr.includes('/webrtc')) {
          console.log(`[BrowserNode]   🌐 WebRTC address: ${addrStr}`);
        } else {
          console.log(`[BrowserNode]   📍 Address: ${addrStr}`);
        }
      }
      
      // Check if we have relay addresses (required for browser-to-browser)
      if (!hasRelayAddr) {
        console.warn('[BrowserNode] ⚠️ No relay addresses after waiting - will retry on peer:identify');
        console.warn('[BrowserNode] This could mean the relay server rejected the reservation or is at capacity');
      }
      if (!hasWebRTCAddr) {
        console.warn('[BrowserNode] ⚠️ No WebRTC addresses - direct browser connections may not work');
      }
      if (hasRelayAddr && hasWebRTCAddr) {
        console.log('[BrowserNode] ✅ Ready for browser-to-browser connections via relay + WebRTC');
      }
    }
  }

  /**
   * Discover peers by performing DHT lookups
   * 
   * This populates the routing table by doing a self-lookup and random lookups.
   * Only dials peers we're not already connected to, and respects connection limits.
   */
  private async discoverPeers(): Promise<void> {
    if (!this.libp2p) return;

    // Don't discover if we're at or near connection limit
    const currentConnections = this.libp2p.getConnections().length;
    if (currentConnections >= this.config.maxConnections * 0.9) {
      console.log(`[BrowserNode] Skipping peer discovery - at connection limit (${currentConnections}/${this.config.maxConnections})`);
      return;
    }

    const dht = this.getDHTService();
    const myPeerId = this.libp2p.peerId;
    
    // Get set of already connected peer IDs to avoid redundant dials
    const connectedPeerIds = new Set<string>();
    for (const conn of this.libp2p.getConnections()) {
      connectedPeerIds.add(conn.remotePeer.toString());
    }
    
    console.log(`[BrowserNode] Starting peer discovery... (${connectedPeerIds.size} peers already connected)`);
    
    try {
      // Perform self-lookup to find peers close to us
      const selfKey = myPeerId.toMultihash().bytes;
      let discoveredCount = 0;
      let newConnectionCount = 0;
      
      for await (const event of dht.getClosestPeers(selfKey)) {
        if (event.name === 'PEER_RESPONSE') {
          for (const peer of event.closer) {
            const peerId = peer.id.toString();
            
            // Skip ourselves
            if (peerId === myPeerId.toString()) continue;
            
            // Skip peers we're already connected to
            if (connectedPeerIds.has(peerId)) {
              continue;
            }
            
            // Check connection limit before each dial attempt
            if (this.libp2p.getConnections().length >= this.config.maxConnections) {
              console.log(`[BrowserNode] Reached connection limit, stopping discovery`);
              break;
            }
            
            discoveredCount++;
            
            // Filter to dialable addresses and try to connect
            const addrs = peer.multiaddrs.map((ma: { toString: () => string }) => ma.toString());
            const dialableAddrs = filterDialableAddresses(addrs);
            
            if (dialableAddrs.length > 0) {
              // Try to connect to this peer (try only first dialable address to save resources)
              const addr = dialableAddrs[0];
              try {
                await this.libp2p.dial(multiaddr(addr));
                console.log(`[BrowserNode] ✅ Connected to discovered peer: ${peerId.slice(0, 16)}...`);
                connectedPeerIds.add(peerId); // Track so we don't try again
                newConnectionCount++;
              } catch (dialError) {
                // Don't log every failure - too noisy
                // Just track that we tried this peer
                connectedPeerIds.add(peerId);
              }
            }
          }
        }
      }
      
      console.log(`[BrowserNode] Peer discovery complete: discovered ${discoveredCount} new peers, connected to ${newConnectionCount}`);
      console.log(`[BrowserNode] Total connections: ${this.libp2p.getConnections().length}`);
    } catch (error) {
      console.log(`[BrowserNode] Peer discovery error: ${error}`);
    }
  }

  /**
   * Start periodic peer discovery
   */
  private startPeriodicPeerDiscovery(): void {
    // Run peer discovery every 60 seconds
    this.peerDiscoveryTimer = setInterval(async () => {
      if (this.libp2p && this.state.status === 'connected') {
        await this.discoverPeers();
      }
    }, 60000);
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

    // Track address changes - useful for debugging relay reservations
    this.libp2p.addEventListener('self:peer:update', (event) => {
      const addrs = this.libp2p?.getMultiaddrs() || [];
      console.log(`[BrowserNode] 🔄 Address update - now have ${addrs.length} addresses`);
      for (const addr of addrs) {
        const addrStr = addr.toString();
        if (addrStr.includes('/p2p-circuit') || addrStr.includes('/webrtc')) {
          console.log(`[BrowserNode]   New address: ${addrStr}`);
        }
      }
    });

    // Track peer identification - needed for relay discovery
    // This is where we can manually trigger reservation if automatic discovery fails
    this.libp2p.addEventListener('peer:identify', async (event) => {
      const peerId = event.detail.peerId.toString();
      const protocols = event.detail.protocols || [];
      console.log(`[BrowserNode] 🔍 Identified peer ${peerId.slice(0, 16)}... with ${protocols.length} protocols`);
      
      // Check if this peer supports circuit relay HOP (server)
      const hopProtocol = protocols.find(p => p.includes('/hop'));
      if (hopProtocol) {
        console.log(`[BrowserNode] ✅ Peer ${peerId.slice(0, 16)}... supports HOP: ${hopProtocol}`);
        console.log(`[BrowserNode] 📡 Relay discovery should attempt reservation on this peer`);
        
        // Check if we already have relay addresses
        const currentAddrs = this.libp2p?.getMultiaddrs() || [];
        const hasRelayAddr = currentAddrs.some(a => a.toString().includes('/p2p-circuit'));
        
        if (!hasRelayAddr) {
          console.log(`[BrowserNode] 🔧 No relay addresses yet, attempting manual reservation on HOP peer...`);
          
          // Try to manually trigger reservation
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const reservationStore = (this as any)._reservationStore;
          if (reservationStore) {
            try {
              // Check pending reservations
              const pendingCount = reservationStore.pendingReservations?.length || 0;
              console.log(`[BrowserNode] 📋 Pending reservations: ${pendingCount}`);
              
              // If no pending reservations, create one first
              if (pendingCount === 0) {
                console.log(`[BrowserNode] 🔧 Creating pending reservation slot...`);
                const reservationId = reservationStore.reserveRelay();
                console.log(`[BrowserNode] ✅ Created pending reservation: ${reservationId}`);
              }
              
              // Now try to add the relay
              const targetPeerId = peerIdFromString(peerId);
              console.log(`[BrowserNode] 🔧 Calling addRelay for ${peerId.slice(0, 16)}...`);
              const result = await reservationStore.addRelay(targetPeerId, 'discovered');
              console.log(`[BrowserNode] 🎉 Manual reservation successful!`, result);
              
              // Check addresses again
              const newAddrs = this.libp2p?.getMultiaddrs() || [];
              console.log(`[BrowserNode] 📍 Addresses after manual reservation: ${newAddrs.length}`);
              for (const addr of newAddrs) {
                console.log(`[BrowserNode]   ${addr.toString()}`);
              }
            } catch (e) {
              const errorName = e instanceof Error ? e.name : 'Unknown';
              const errorMsg = e instanceof Error ? e.message : String(e);
              // HadEnoughRelaysError is expected if we already have a reservation
              if (errorName !== 'HadEnoughRelaysError') {
                console.log(`[BrowserNode] ⚠️ Manual reservation attempt: ${errorName}: ${errorMsg}`);
              } else {
                console.log(`[BrowserNode] ℹ️ Already have enough relays (HadEnoughRelaysError)`);
              }
            }
          } else {
            console.log(`[BrowserNode] ⚠️ Reservation store not available for manual reservation`);
          }
        }
      }
      
      // Check if this peer supports circuit relay STOP (client)
      const stopProtocol = protocols.find(p => p.includes('/stop'));
      if (stopProtocol) {
        console.log(`[BrowserNode] 📥 Peer ${peerId.slice(0, 16)}... supports STOP: ${stopProtocol}`);
      }
    });

    // Listen for transport:listening events to see when relay addresses are added
    this.libp2p.addEventListener('transport:listening', (event) => {
      console.log(`[BrowserNode] 🎧 Transport listening event:`, event);
    });

    // Listen for transport:close events
    this.libp2p.addEventListener('transport:close', (event) => {
      console.log(`[BrowserNode] 🔇 Transport close event:`, event);
    });

    // Log all libp2p events for debugging relay issues
    // Note: Transport-specific setup (reservation store, discovery) is done in
    // captureReservationStoreReference() which is called AFTER libp2p.start()
  }

  /**
   * Capture reference to the circuit relay transport's reservation store
   * This must be called AFTER libp2p.start() because transports are only
   * fully initialized after start.
   */
  private captureReservationStoreReference(): void {
    if (!this.libp2p) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const libp2pAny = this.libp2p as any;
    
    // Try to access the circuit relay transport's reservation store
    if (libp2pAny.components?.transportManager) {
      console.log('[BrowserNode] 🔧 TransportManager available (after start)');
      const transports = libp2pAny.components.transportManager.transports;
      if (transports) {
        for (const [name, transport] of transports) {
          console.log(`[BrowserNode] 🚗 Transport: ${name}`);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const t = transport as any;
          if (t.reservationStore) {
            console.log('[BrowserNode] 📋 Found reservation store on transport');
            console.log(`[BrowserNode] 📋 Pending reservations: ${t.reservationStore.pendingReservations?.length || 0}`);
            console.log(`[BrowserNode] 📋 Current reservations: ${t.reservationStore.reservations?.size || 0}`);
            
            // Listen for reservation events
            t.reservationStore.addEventListener('relay:not-enough-relays', () => {
              console.log('[BrowserNode] ⚠️ relay:not-enough-relays event fired');
              console.log(`[BrowserNode] 📋 Pending reservations: ${t.reservationStore.pendingReservations?.length || 0}`);
              console.log(`[BrowserNode] 📋 Current reservations: ${t.reservationStore.reservations?.size || 0}`);
            });
            t.reservationStore.addEventListener('relay:found-enough-relays', () => {
              console.log('[BrowserNode] ✅ relay:found-enough-relays event fired');
              console.log(`[BrowserNode] 📋 Pending reservations: ${t.reservationStore.pendingReservations?.length || 0}`);
              console.log(`[BrowserNode] 📋 Current reservations: ${t.reservationStore.reservations?.size || 0}`);
            });
            t.reservationStore.addEventListener('relay:created-reservation', (evt: CustomEvent) => {
              console.log('[BrowserNode] 🎉 relay:created-reservation event fired:', evt.detail);
              // Log the new addresses
              const addrs = this.libp2p?.getMultiaddrs() || [];
              console.log(`[BrowserNode] 📍 New addresses after reservation: ${addrs.length}`);
              for (const addr of addrs) {
                console.log(`[BrowserNode]   ${addr.toString()}`);
              }
            });
            t.reservationStore.addEventListener('relay:removed', (evt: CustomEvent) => {
              console.log('[BrowserNode] ❌ relay:removed event fired:', evt.detail);
            });
            
            // Store reference for manual reservation attempt
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any)._reservationStore = t.reservationStore;
          }
          
          // Check for relay discovery
          if (t.discovery) {
            console.log('[BrowserNode] 🔍 Found relay discovery on transport');
            console.log(`[BrowserNode] 🔍 Discovery started: ${t.discovery.started}`);
            console.log(`[BrowserNode] 🔍 Discovery running: ${t.discovery.running}`);
            t.discovery.addEventListener('relay:discover', (evt: CustomEvent) => {
              const peerId = evt.detail?.toString?.() || 'unknown';
              console.log(`[BrowserNode] 🔍 relay:discover event fired for peer: ${peerId.slice(0, 16)}...`);
              console.log(`[BrowserNode] 📋 Pending reservations at discovery: ${t.reservationStore?.pendingReservations?.length || 0}`);
            });
            
            // Store reference for manual discovery trigger
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any)._relayDiscovery = t.discovery;
          }
        }
      }
    } else {
      console.warn('[BrowserNode] ⚠️ TransportManager not available after start');
    }
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

    console.log('[BrowserNode] Initializing overlay network...');

    try {
      // Create DHT adapter for the overlay network
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.dhtAdapter = new BrowserDHTAdapter(this.libp2p as any);
      console.log('[BrowserNode] Created DHT adapter for overlay');

      // Create overlay network with the DHT adapter
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.overlayNetwork = new OverlayNetwork(this.dhtAdapter as any);
      console.log('[BrowserNode] Created overlay network instance');

      // Start the overlay network (this publishes public key to DHT)
      await this.overlayNetwork.start();
      console.log('[BrowserNode] Overlay network started successfully');

      // Register message handler if one was set before start
      if (this.messageHandler) {
        const handler = this.messageHandler;
        this.overlayNetwork.onMessage((payload: Uint8Array, context: OverlayMessageContext) => {
          return handler(payload, {
            originPeerId: context.originPeerId,
            messageId: context.messageId,
          });
        });
        console.log('[BrowserNode] Registered message handler with overlay');
      }
    } catch (error) {
      console.error('[BrowserNode] Failed to initialize overlay network:', error);
      // Don't throw - allow the node to continue without overlay
      // The overlay can be retried later or user can be notified
      this.overlayNetwork = null;
      this.dhtAdapter = null;
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
   * Check if overlay network is available and started
   * 
   * @returns true if overlay is enabled and successfully initialized
   */
  isOverlayAvailable(): boolean {
    return this.overlayNetwork !== null && this.overlayNetwork.isStarted;
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
