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
import { type Multiaddr } from '@multiformats/multiaddr';
import { CID } from 'multiformats/cid';
import { type DHTNodeConfig } from './config.js';
import { type RoutingTableInfo, type BucketInfo, type RoutingPeerInfo } from './routing.js';
export type { RoutingTableInfo, BucketInfo, RoutingPeerInfo };
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
export type DHTNodeEventType = 'peer:connect' | 'peer:disconnect' | 'dht:routing:refresh';
/**
 * Event handler function type
 */
export type DHTNodeEventHandler<T = unknown> = (data: T) => void;
/**
 * Main DHT node facade class.
 * Wraps libp2p node and provides simplified DHT operations.
 */
export declare class DHTNode {
    private node;
    private readonly config;
    private started;
    private eventHandlers;
    /**
     * Create a new DHTNode instance.
     * Note: Call start() to initialize and start the node.
     *
     * @param config - DHT node configuration
     */
    constructor(config: DHTNodeConfig);
    /**
     * Get the peer ID of this node.
     * @throws DHTError if node is not started
     */
    get peerId(): PeerId;
    /**
     * Get the multiaddresses this node is listening on.
     * @throws DHTError if node is not started
     */
    get multiaddrs(): Multiaddr[];
    /**
     * Check if the node is currently running.
     */
    get isStarted(): boolean;
    /**
     * Start the DHT node.
     * Initializes the libp2p node, starts listening on configured addresses,
     * and initializes the Kademlia routing table.
     *
     * Requirements: 1.1, 1.2, 1.3
     *
     * @throws DHTError if node fails to start
     */
    start(): Promise<void>;
    /**
     * Stop the DHT node.
     * Gracefully shuts down connections and releases resources.
     *
     * Requirements: 6.1
     */
    stop(): Promise<void>;
    /**
     * Bootstrap the node by connecting to bootstrap peers.
     * If no peers are provided, uses the bootstrap peers from configuration.
     *
     * Requirements: 2.1, 2.2, 2.3, 2.4
     *
     * @param peers - Optional array of multiaddr strings to bootstrap from
     * @throws DHTError with BOOTSTRAP_FAILED if all bootstrap peers are unreachable
     */
    bootstrap(peers?: string[]): Promise<void>;
    /**
     * Find a specific peer in the network.
     *
     * Requirements: 3.1
     *
     * @param peerId - The peer ID to find (can be string or PeerId object)
     * @returns Promise resolving to PeerInfo for the found peer
     * @throws DHTError with NOT_FOUND if peer cannot be found
     */
    findPeer(peerId: PeerId | string): Promise<PeerInfo>;
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
    put(key: Uint8Array, value: Uint8Array): Promise<void>;
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
    get(key: Uint8Array): Promise<Uint8Array>;
    /**
     * Get the closest peers to a given key.
     * Returns peers ordered by ascending XOR distance to the target key.
     *
     * Requirements: 3.1, 3.5
     *
     * @param key - The key to find closest peers for
     * @yields PeerInfo objects for peers closest to the key
     */
    getClosestPeers(key: Uint8Array): AsyncIterable<PeerInfo>;
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
    provide(key: CID | string): Promise<void>;
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
    findProviders(key: CID | string): AsyncIterable<PeerInfo>;
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
    /**
     * Remove an event handler.
     *
     * @param event - Event type
     * @param handler - Handler function to remove
     */
    off(event: DHTNodeEventType, handler: DHTNodeEventHandler<PeerId> | DHTNodeEventHandler<void>): void;
    /**
     * Get the underlying libp2p node (for advanced use cases).
     * @throws DHTError if node is not started
     */
    getLibp2pNode(): Libp2p;
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
    getRoutingTableInfo(): RoutingTableInfo;
    /**
     * Get connection management information.
     * Returns current connection state including counts and limits.
     *
     * Requirements: 6.2, 6.3, 6.4
     *
     * @returns ConnectionInfo with current connection state
     * @throws DHTError if node is not started
     */
    getConnectionInfo(): ConnectionInfo;
    /**
     * Check if the node can accept more connections.
     * Returns true if current connections are below the maximum limit.
     *
     * Requirements: 6.3
     *
     * @returns true if more connections can be accepted
     * @throws DHTError if node is not started
     */
    canAcceptConnections(): boolean;
    /**
     * Get the number of current connections.
     *
     * Requirements: 6.2
     *
     * @returns number of active connections
     * @throws DHTError if node is not started
     */
    getConnectionCount(): number;
    /**
     * Validate a key-value pair before storage.
     * @throws DHTError with INVALID_RECORD if validation fails
     */
    private validateKeyValue;
    /**
     * Ensure the node is started before performing operations.
     */
    private ensureStarted;
    /**
     * Get the DHT service from the libp2p node.
     */
    private getDHTService;
    /**
     * Set up event listeners on the libp2p node.
     */
    private setupEventListeners;
    /**
     * Remove event listeners from the libp2p node.
     */
    private removeEventListeners;
    /**
     * Emit an event to all registered handlers.
     */
    private emitEvent;
    /**
     * Sort peers by XOR distance to a target key.
     */
    private sortPeersByDistance;
    /**
     * Parse a CID from string or return as-is if already a CID.
     * @throws DHTError with INVALID_RECORD if CID is invalid
     */
    private parseCID;
}
//# sourceMappingURL=node.d.ts.map