/**
 * Configuration types and builder for Kademlia DHT nodes
 *
 * Provides interfaces for node configuration, a fluent builder API,
 * and serialization/deserialization functions for persistence.
 */
/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
    kBucketSize: 20,
    alpha: 3,
    refreshInterval: 3600000, // 1 hour in ms
    recordExpiration: 86400000, // 24 hours in ms
    providerExpiration: 86400000, // 24 hours in ms
    maxConnections: 100,
    minConnections: 5,
    protocol: '/ipfs/kad/1.0.0',
};
/**
 * Configuration validation error
 */
export class ConfigValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConfigValidationError';
    }
}
/**
 * Validate a DHT node configuration
 * @throws ConfigValidationError if configuration is invalid
 */
export function validateConfig(config) {
    // Required field: listenAddresses
    if (!config.listenAddresses || config.listenAddresses.length === 0) {
        throw new ConfigValidationError('listenAddresses is required and must not be empty');
    }
    // Validate listenAddresses are strings
    for (const addr of config.listenAddresses) {
        if (typeof addr !== 'string' || addr.trim() === '') {
            throw new ConfigValidationError('listenAddresses must contain non-empty strings');
        }
    }
    // Validate kBucketSize range
    if (config.kBucketSize !== undefined) {
        if (!Number.isInteger(config.kBucketSize) || config.kBucketSize < 1 || config.kBucketSize > 100) {
            throw new ConfigValidationError('kBucketSize must be an integer between 1 and 100');
        }
    }
    // Validate alpha range
    if (config.alpha !== undefined) {
        if (!Number.isInteger(config.alpha) || config.alpha < 1 || config.alpha > 20) {
            throw new ConfigValidationError('alpha must be an integer between 1 and 20');
        }
    }
    // Validate refreshInterval
    if (config.refreshInterval !== undefined) {
        if (!Number.isInteger(config.refreshInterval) || config.refreshInterval < 1000) {
            throw new ConfigValidationError('refreshInterval must be an integer >= 1000ms');
        }
    }
    // Validate recordExpiration
    if (config.recordExpiration !== undefined) {
        if (!Number.isInteger(config.recordExpiration) || config.recordExpiration < 1000) {
            throw new ConfigValidationError('recordExpiration must be an integer >= 1000ms');
        }
    }
    // Validate providerExpiration
    if (config.providerExpiration !== undefined) {
        if (!Number.isInteger(config.providerExpiration) || config.providerExpiration < 1000) {
            throw new ConfigValidationError('providerExpiration must be an integer >= 1000ms');
        }
    }
    // Validate maxConnections
    if (config.maxConnections !== undefined) {
        if (!Number.isInteger(config.maxConnections) || config.maxConnections < 1) {
            throw new ConfigValidationError('maxConnections must be a positive integer');
        }
    }
    // Validate minConnections
    if (config.minConnections !== undefined) {
        if (!Number.isInteger(config.minConnections) || config.minConnections < 0) {
            throw new ConfigValidationError('minConnections must be a non-negative integer');
        }
    }
    // Validate min <= max connections
    const maxConn = config.maxConnections ?? DEFAULT_CONFIG.maxConnections;
    const minConn = config.minConnections ?? DEFAULT_CONFIG.minConnections;
    if (minConn > maxConn) {
        throw new ConfigValidationError('minConnections cannot exceed maxConnections');
    }
    // Validate circuitRelay.reservationTTL
    if (config.circuitRelay?.reservationTTL !== undefined) {
        if (!Number.isInteger(config.circuitRelay.reservationTTL) || config.circuitRelay.reservationTTL < 1000) {
            throw new ConfigValidationError('circuitRelay.reservationTTL must be an integer >= 1000ms');
        }
    }
}
/**
 * Fluent builder for DHT node configuration
 */
export class DHTConfigBuilder {
    config = {};
    /**
     * Create a new configuration builder
     */
    static create() {
        return new DHTConfigBuilder();
    }
    /**
     * Set listen addresses for the node
     */
    withListenAddresses(addresses) {
        this.config.listenAddresses = [...addresses];
        return this;
    }
    /**
     * Set announce addresses (public addresses to advertise)
     */
    withAnnounceAddresses(addresses) {
        this.config.announceAddresses = [...addresses];
        return this;
    }
    /**
     * Set bootstrap peers for network join
     */
    withBootstrapPeers(peers) {
        this.config.bootstrapPeers = [...peers];
        return this;
    }
    /**
     * Set k-bucket size (replication parameter)
     */
    withKBucketSize(k) {
        this.config.kBucketSize = k;
        return this;
    }
    /**
     * Set alpha (concurrency parameter for lookups)
     */
    withAlpha(alpha) {
        this.config.alpha = alpha;
        return this;
    }
    /**
     * Set DHT protocol identifier
     */
    withProtocol(protocol) {
        this.config.protocol = protocol;
        return this;
    }
    /**
     * Set client mode (node won't respond to DHT queries)
     */
    withClientMode(clientMode) {
        this.config.clientMode = clientMode;
        return this;
    }
    /**
     * Set routing table refresh interval in milliseconds
     */
    withRefreshInterval(ms) {
        this.config.refreshInterval = ms;
        return this;
    }
    /**
     * Set record expiration time in milliseconds
     */
    withRecordExpiration(ms) {
        this.config.recordExpiration = ms;
        return this;
    }
    /**
     * Set provider record expiration time in milliseconds
     */
    withProviderExpiration(ms) {
        this.config.providerExpiration = ms;
        return this;
    }
    /**
     * Set maximum concurrent connections
     */
    withMaxConnections(max) {
        this.config.maxConnections = max;
        return this;
    }
    /**
     * Set minimum connections to maintain
     */
    withMinConnections(min) {
        this.config.minConnections = min;
        return this;
    }
    /**
     * Set private key for node identity
     */
    withPrivateKey(key) {
        this.config.privateKey = new Uint8Array(key);
        return this;
    }
    /**
     * Configure WebRTC transport
     */
    withWebRTC(stunServers, turnServers) {
        this.config.webrtc = {
            enabled: true,
            stunServers: stunServers ? [...stunServers] : undefined,
            turnServers: turnServers ? turnServers.map(t => ({ ...t, urls: [...t.urls] })) : undefined,
        };
        return this;
    }
    /**
     * Configure circuit relay for NAT traversal
     */
    withCircuitRelay(enabled, reservationTTL) {
        this.config.circuitRelay = {
            enabled,
            reservationTTL,
        };
        return this;
    }
    /**
     * Apply oracle-yz specific optimizations (WSS via imeyouwe.com)
     */
    forOracleYZ() {
        // Configure for oracle-yz deployment with WSS through nginx
        this.config.listenAddresses = this.config.listenAddresses ?? [];
        if (!this.config.listenAddresses.some(a => a.includes('ws'))) {
            this.config.listenAddresses.push('/ip4/0.0.0.0/tcp/0/ws');
        }
        this.config.circuitRelay = { enabled: true };
        return this;
    }
    /**
     * Configure for browser environment (WebRTC + WSS)
     */
    forBrowser() {
        this.config.webrtc = {
            enabled: true,
            stunServers: ['stun:stun.l.google.com:19302'],
        };
        this.config.circuitRelay = { enabled: true };
        // Browsers typically use WebSocket connections
        this.config.listenAddresses = this.config.listenAddresses ?? [];
        return this;
    }
    /**
     * Build and validate the configuration
     * @throws ConfigValidationError if configuration is invalid
     */
    build() {
        const config = {
            listenAddresses: this.config.listenAddresses ?? [],
            ...this.config,
        };
        validateConfig(config);
        return config;
    }
}
/**
 * Serialize a DHT node configuration to JSON-compatible format
 */
export function serializeConfig(config) {
    return {
        listenAddresses: [...config.listenAddresses],
        announceAddresses: config.announceAddresses ? [...config.announceAddresses] : undefined,
        bootstrapPeers: config.bootstrapPeers ? [...config.bootstrapPeers] : [],
        kBucketSize: config.kBucketSize ?? DEFAULT_CONFIG.kBucketSize,
        alpha: config.alpha ?? DEFAULT_CONFIG.alpha,
        refreshInterval: config.refreshInterval ?? DEFAULT_CONFIG.refreshInterval,
        recordExpiration: config.recordExpiration ?? DEFAULT_CONFIG.recordExpiration,
        providerExpiration: config.providerExpiration ?? DEFAULT_CONFIG.providerExpiration,
        maxConnections: config.maxConnections ?? DEFAULT_CONFIG.maxConnections,
        minConnections: config.minConnections ?? DEFAULT_CONFIG.minConnections,
        protocol: config.protocol,
        clientMode: config.clientMode,
        webrtc: config.webrtc ? {
            enabled: config.webrtc.enabled,
            stunServers: config.webrtc.stunServers ? [...config.webrtc.stunServers] : undefined,
            turnServers: config.webrtc.turnServers?.map(t => ({
                urls: [...t.urls],
                username: t.username,
                credential: t.credential,
            })),
        } : undefined,
        circuitRelay: config.circuitRelay ? {
            enabled: config.circuitRelay.enabled,
            reservationTTL: config.circuitRelay.reservationTTL,
        } : undefined,
    };
}
/**
 * Deserialize a JSON configuration back to DHTNodeConfig
 */
export function deserializeConfig(json) {
    const config = {
        listenAddresses: [...json.listenAddresses],
        announceAddresses: json.announceAddresses ? [...json.announceAddresses] : undefined,
        bootstrapPeers: json.bootstrapPeers ? [...json.bootstrapPeers] : undefined,
        kBucketSize: json.kBucketSize,
        alpha: json.alpha,
        refreshInterval: json.refreshInterval,
        recordExpiration: json.recordExpiration,
        providerExpiration: json.providerExpiration,
        maxConnections: json.maxConnections,
        minConnections: json.minConnections,
        protocol: json.protocol,
        clientMode: json.clientMode,
        webrtc: json.webrtc ? {
            enabled: json.webrtc.enabled,
            stunServers: json.webrtc.stunServers ? [...json.webrtc.stunServers] : undefined,
            turnServers: json.webrtc.turnServers?.map(t => ({
                urls: [...t.urls],
                username: t.username,
                credential: t.credential,
            })),
        } : undefined,
        circuitRelay: json.circuitRelay ? {
            enabled: json.circuitRelay.enabled,
            reservationTTL: json.circuitRelay.reservationTTL,
        } : undefined,
    };
    validateConfig(config);
    return config;
}
//# sourceMappingURL=config.js.map