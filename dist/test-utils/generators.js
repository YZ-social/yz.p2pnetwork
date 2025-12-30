/**
 * Fast-check generators for DHT testing
 *
 * Provides reusable arbitraries for generating:
 * - Peer IDs (byte arrays representing cryptographic identifiers)
 * - Uint8Arrays of various sizes
 * - Valid DHT node configurations
 *
 * Requirements: 7.1, 7.2
 */
import * as fc from 'fast-check';
/**
 * Generate a Uint8Array of specified length range
 * Useful for keys, values, and peer ID bytes
 */
export function uint8ArrayArbitrary(options = {}) {
    const { minLength = 1, maxLength = 64 } = options;
    return fc.uint8Array({ minLength, maxLength });
}
/**
 * Generate a peer ID as a Uint8Array
 * Peer IDs in libp2p are typically 32-byte (256-bit) cryptographic hashes
 */
export function peerIdArbitrary(options = {}) {
    const { length = 32 } = options;
    return fc.uint8Array({ minLength: length, maxLength: length });
}
/**
 * Generate a valid multiaddr-like listen address string
 */
export const listenAddressArbitrary = fc.constantFrom('/ip4/0.0.0.0/tcp/0', '/ip4/127.0.0.1/tcp/4001', '/ip4/0.0.0.0/tcp/0/ws', '/ip6/::/tcp/0', '/ip4/0.0.0.0/udp/0/quic-v1', '/ip4/127.0.0.1/tcp/8080/ws', '/ip4/0.0.0.0/tcp/4002');
/**
 * Generate a valid bootstrap peer multiaddr string
 */
export const bootstrapPeerArbitrary = fc.constantFrom('/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ', '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN', '/ip4/147.75.109.213/tcp/4001/p2p/QmZa1sAxajnQjVM8WjWXoMbmPd7NsWhfKsPkErzpm9wGkp', '/ip4/147.75.109.29/tcp/4001/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa');
/**
 * Generate a valid STUN server URL
 */
export const stunServerArbitrary = fc.constantFrom('stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302', 'stun:stun3.l.google.com:19302', 'stun:stun4.l.google.com:19302');
/**
 * Generate a valid TURN server configuration
 */
export const turnServerArbitrary = fc.record({
    urls: fc.array(fc.constantFrom('turn:turn.example.com:3478', 'turn:turn.example.org:3478', 'turns:turn.example.com:5349'), { minLength: 1, maxLength: 3 }),
    username: fc.option(fc.string({ minLength: 1, maxLength: 32 }), { nil: undefined }),
    credential: fc.option(fc.string({ minLength: 1, maxLength: 64 }), { nil: undefined }),
});
/**
 * Generate a valid WebRTC configuration
 */
export const webrtcConfigArbitrary = fc.record({
    enabled: fc.boolean(),
    stunServers: fc.option(fc.array(stunServerArbitrary, { minLength: 1, maxLength: 3 }), { nil: undefined }),
    turnServers: fc.option(fc.array(turnServerArbitrary, { minLength: 0, maxLength: 2 }), { nil: undefined }),
});
/**
 * Generate a valid circuit relay configuration
 */
export const circuitRelayConfigArbitrary = fc.record({
    enabled: fc.boolean(),
    reservationTTL: fc.option(fc.integer({ min: 1000, max: 3600000 }), { nil: undefined }),
});
/**
 * Generate a valid DHT protocol string
 */
export const protocolArbitrary = fc.constantFrom('/ipfs/kad/1.0.0', '/custom/dht/1.0.0', '/oracle-yz/kad/1.0.0');
/**
 * Generate a valid DHTNodeConfig object
 * All generated configs pass validation
 */
export const configArbitrary = fc
    .record({
    listenAddresses: fc.array(listenAddressArbitrary, { minLength: 1, maxLength: 5 }),
    announceAddresses: fc.option(fc.array(listenAddressArbitrary, { minLength: 1, maxLength: 3 }), { nil: undefined }),
    kBucketSize: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
    alpha: fc.option(fc.integer({ min: 1, max: 20 }), { nil: undefined }),
    protocol: fc.option(protocolArbitrary, { nil: undefined }),
    clientMode: fc.option(fc.boolean(), { nil: undefined }),
    refreshInterval: fc.option(fc.integer({ min: 1000, max: 86400000 }), { nil: undefined }),
    recordExpiration: fc.option(fc.integer({ min: 1000, max: 604800000 }), { nil: undefined }),
    providerExpiration: fc.option(fc.integer({ min: 1000, max: 604800000 }), { nil: undefined }),
    // Generate maxConnections first, then constrain minConnections
    maxConnections: fc.option(fc.integer({ min: 5, max: 1000 }), { nil: undefined }),
    minConnections: fc.option(fc.integer({ min: 0, max: 5 }), { nil: undefined }),
    bootstrapPeers: fc.option(fc.array(bootstrapPeerArbitrary, { minLength: 0, maxLength: 3 }), { nil: undefined }),
    webrtc: fc.option(webrtcConfigArbitrary, { nil: undefined }),
    circuitRelay: fc.option(circuitRelayConfigArbitrary, { nil: undefined }),
})
    .filter((config) => {
    // Ensure minConnections <= maxConnections when both are defined
    const maxConn = config.maxConnections ?? 100;
    const minConn = config.minConnections ?? 5;
    return minConn <= maxConn;
});
/**
 * Generate a minimal valid DHTNodeConfig (only required fields)
 */
export const minimalConfigArbitrary = fc
    .array(listenAddressArbitrary, { minLength: 1, maxLength: 3 })
    .map((listenAddresses) => ({ listenAddresses }));
/**
 * Generate a DHT key (typically 32 bytes for content addressing)
 */
export function dhtKeyArbitrary(options = {}) {
    const { length = 32 } = options;
    return fc.uint8Array({ minLength: length, maxLength: length });
}
/**
 * Generate a DHT value (variable length content)
 */
export function dhtValueArbitrary(options = {}) {
    const { minLength = 1, maxLength = 1024 } = options;
    return fc.uint8Array({ minLength, maxLength });
}
/**
 * Generate a key-value pair for DHT storage
 */
export const keyValuePairArbitrary = fc.record({
    key: dhtKeyArbitrary(),
    value: dhtValueArbitrary(),
});
/**
 * Generate an array of peer IDs (useful for testing routing operations)
 */
export function peerIdArrayArbitrary(options = {}) {
    const { minLength = 1, maxLength = 20, peerIdLength = 32 } = options;
    return fc.array(peerIdArbitrary({ length: peerIdLength }), { minLength, maxLength });
}
//# sourceMappingURL=generators.js.map