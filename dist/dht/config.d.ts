/**
 * Configuration types and builder for Kademlia DHT nodes
 *
 * Provides interfaces for node configuration, a fluent builder API,
 * and serialization/deserialization functions for persistence.
 */
/**
 * TURN server configuration for WebRTC NAT traversal
 */
export interface TurnServer {
    urls: string[];
    username?: string;
    credential?: string;
}
/**
 * WebRTC configuration options
 */
export interface WebRTCConfig {
    enabled: boolean;
    stunServers?: string[];
    turnServers?: TurnServer[];
}
/**
 * Circuit relay configuration for NAT traversal
 */
export interface CircuitRelayConfig {
    enabled: boolean;
    reservationTTL?: number;
}
/**
 * Main DHT node configuration interface
 */
export interface DHTNodeConfig {
    privateKey?: Uint8Array;
    listenAddresses: string[];
    announceAddresses?: string[];
    kBucketSize?: number;
    alpha?: number;
    protocol?: string;
    clientMode?: boolean;
    refreshInterval?: number;
    recordExpiration?: number;
    providerExpiration?: number;
    maxConnections?: number;
    minConnections?: number;
    bootstrapPeers?: string[];
    webrtc?: WebRTCConfig;
    circuitRelay?: CircuitRelayConfig;
}
/**
 * Serialized configuration format for JSON persistence
 */
export interface SerializedConfig {
    listenAddresses: string[];
    announceAddresses?: string[];
    bootstrapPeers: string[];
    kBucketSize: number;
    alpha: number;
    refreshInterval: number;
    recordExpiration: number;
    providerExpiration: number;
    maxConnections: number;
    minConnections: number;
    protocol?: string;
    clientMode?: boolean;
    webrtc?: WebRTCConfig;
    circuitRelay?: CircuitRelayConfig;
}
/**
 * Default configuration values
 */
export declare const DEFAULT_CONFIG: {
    readonly kBucketSize: 20;
    readonly alpha: 3;
    readonly refreshInterval: 3600000;
    readonly recordExpiration: 86400000;
    readonly providerExpiration: 86400000;
    readonly maxConnections: 100;
    readonly minConnections: 5;
    readonly protocol: "/ipfs/kad/1.0.0";
};
/**
 * Configuration validation error
 */
export declare class ConfigValidationError extends Error {
    constructor(message: string);
}
/**
 * Validate a DHT node configuration
 * @throws ConfigValidationError if configuration is invalid
 */
export declare function validateConfig(config: DHTNodeConfig): void;
/**
 * Fluent builder for DHT node configuration
 */
export declare class DHTConfigBuilder {
    private config;
    /**
     * Create a new configuration builder
     */
    static create(): DHTConfigBuilder;
    /**
     * Set listen addresses for the node
     */
    withListenAddresses(addresses: string[]): this;
    /**
     * Set announce addresses (public addresses to advertise)
     */
    withAnnounceAddresses(addresses: string[]): this;
    /**
     * Set bootstrap peers for network join
     */
    withBootstrapPeers(peers: string[]): this;
    /**
     * Set k-bucket size (replication parameter)
     */
    withKBucketSize(k: number): this;
    /**
     * Set alpha (concurrency parameter for lookups)
     */
    withAlpha(alpha: number): this;
    /**
     * Set DHT protocol identifier
     */
    withProtocol(protocol: string): this;
    /**
     * Set client mode (node won't respond to DHT queries)
     */
    withClientMode(clientMode: boolean): this;
    /**
     * Set routing table refresh interval in milliseconds
     */
    withRefreshInterval(ms: number): this;
    /**
     * Set record expiration time in milliseconds
     */
    withRecordExpiration(ms: number): this;
    /**
     * Set provider record expiration time in milliseconds
     */
    withProviderExpiration(ms: number): this;
    /**
     * Set maximum concurrent connections
     */
    withMaxConnections(max: number): this;
    /**
     * Set minimum connections to maintain
     */
    withMinConnections(min: number): this;
    /**
     * Set private key for node identity
     */
    withPrivateKey(key: Uint8Array): this;
    /**
     * Configure WebRTC transport
     */
    withWebRTC(stunServers?: string[], turnServers?: TurnServer[]): this;
    /**
     * Configure circuit relay for NAT traversal
     */
    withCircuitRelay(enabled: boolean, reservationTTL?: number): this;
    /**
     * Apply oracle-yz specific optimizations (WSS via imeyouwe.com)
     */
    forOracleYZ(): this;
    /**
     * Configure for browser environment (WebRTC + WSS)
     */
    forBrowser(): this;
    /**
     * Build and validate the configuration
     * @throws ConfigValidationError if configuration is invalid
     */
    build(): DHTNodeConfig;
}
/**
 * Serialize a DHT node configuration to JSON-compatible format
 */
export declare function serializeConfig(config: DHTNodeConfig): SerializedConfig;
/**
 * Deserialize a JSON configuration back to DHTNodeConfig
 */
export declare function deserializeConfig(json: SerializedConfig): DHTNodeConfig;
//# sourceMappingURL=config.d.ts.map