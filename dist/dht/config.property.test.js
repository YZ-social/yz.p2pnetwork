/**
 * Property-based tests for DHT configuration
 *
 * Feature: kademlia-dht-libp2p
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { serializeConfig, deserializeConfig, DEFAULT_CONFIG, } from './config.js';
/**
 * Arbitrary for generating valid TURN server configurations
 */
const turnServerArbitrary = fc.record({
    urls: fc.array(fc.webUrl(), { minLength: 1, maxLength: 3 }),
    username: fc.option(fc.string({ minLength: 1, maxLength: 32 }), { nil: undefined }),
    credential: fc.option(fc.string({ minLength: 1, maxLength: 64 }), { nil: undefined }),
});
/**
 * Arbitrary for generating valid WebRTC configurations
 */
const webrtcConfigArbitrary = fc.record({
    enabled: fc.boolean(),
    stunServers: fc.option(fc.array(fc.constantFrom('stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'), { minLength: 1, maxLength: 3 }), { nil: undefined }),
    turnServers: fc.option(fc.array(turnServerArbitrary, { minLength: 0, maxLength: 2 }), { nil: undefined }),
});
/**
 * Arbitrary for generating valid circuit relay configurations
 */
const circuitRelayConfigArbitrary = fc.record({
    enabled: fc.boolean(),
    reservationTTL: fc.option(fc.integer({ min: 1000, max: 3600000 }), { nil: undefined }),
});
/**
 * Arbitrary for generating valid multiaddr-like listen addresses
 */
const listenAddressArbitrary = fc.constantFrom('/ip4/0.0.0.0/tcp/0', '/ip4/127.0.0.1/tcp/4001', '/ip4/0.0.0.0/tcp/0/ws', '/ip6/::/tcp/0', '/ip4/0.0.0.0/udp/0/quic-v1');
/**
 * Arbitrary for generating valid DHTNodeConfig objects
 * Note: privateKey is excluded as it's not serialized
 */
const dhtNodeConfigArbitrary = fc.record({
    listenAddresses: fc.array(listenAddressArbitrary, { minLength: 1, maxLength: 5 }),
    announceAddresses: fc.option(fc.array(listenAddressArbitrary, { minLength: 1, maxLength: 3 }), { nil: undefined }),
    kBucketSize: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
    alpha: fc.option(fc.integer({ min: 1, max: 20 }), { nil: undefined }),
    protocol: fc.option(fc.constantFrom('/ipfs/kad/1.0.0', '/custom/dht/1.0.0'), { nil: undefined }),
    clientMode: fc.option(fc.boolean(), { nil: undefined }),
    refreshInterval: fc.option(fc.integer({ min: 1000, max: 86400000 }), { nil: undefined }),
    recordExpiration: fc.option(fc.integer({ min: 1000, max: 604800000 }), { nil: undefined }),
    providerExpiration: fc.option(fc.integer({ min: 1000, max: 604800000 }), { nil: undefined }),
    maxConnections: fc.option(fc.integer({ min: 5, max: 1000 }), { nil: undefined }),
    minConnections: fc.option(fc.integer({ min: 0, max: 5 }), { nil: undefined }),
    bootstrapPeers: fc.option(fc.array(fc.constantFrom('/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ', '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN'), { minLength: 0, maxLength: 3 }), { nil: undefined }),
    webrtc: fc.option(webrtcConfigArbitrary, { nil: undefined }),
    circuitRelay: fc.option(circuitRelayConfigArbitrary, { nil: undefined }),
});
/**
 * Helper to compare two configs for equivalence after round-trip
 * Handles default value application during serialization
 */
function configsAreEquivalent(original, roundTripped) {
    // listenAddresses must match exactly
    if (JSON.stringify(original.listenAddresses) !== JSON.stringify(roundTripped.listenAddresses)) {
        return false;
    }
    // announceAddresses
    if (JSON.stringify(original.announceAddresses) !== JSON.stringify(roundTripped.announceAddresses)) {
        return false;
    }
    // Numeric fields - round-tripped gets defaults applied
    const origKBucket = original.kBucketSize ?? DEFAULT_CONFIG.kBucketSize;
    if (origKBucket !== roundTripped.kBucketSize)
        return false;
    const origAlpha = original.alpha ?? DEFAULT_CONFIG.alpha;
    if (origAlpha !== roundTripped.alpha)
        return false;
    const origRefresh = original.refreshInterval ?? DEFAULT_CONFIG.refreshInterval;
    if (origRefresh !== roundTripped.refreshInterval)
        return false;
    const origRecordExp = original.recordExpiration ?? DEFAULT_CONFIG.recordExpiration;
    if (origRecordExp !== roundTripped.recordExpiration)
        return false;
    const origProviderExp = original.providerExpiration ?? DEFAULT_CONFIG.providerExpiration;
    if (origProviderExp !== roundTripped.providerExpiration)
        return false;
    const origMaxConn = original.maxConnections ?? DEFAULT_CONFIG.maxConnections;
    if (origMaxConn !== roundTripped.maxConnections)
        return false;
    const origMinConn = original.minConnections ?? DEFAULT_CONFIG.minConnections;
    if (origMinConn !== roundTripped.minConnections)
        return false;
    // Optional string/boolean fields
    if (original.protocol !== roundTripped.protocol)
        return false;
    if (original.clientMode !== roundTripped.clientMode)
        return false;
    // bootstrapPeers - empty array vs undefined handled
    const origBootstrap = original.bootstrapPeers ?? [];
    const rtBootstrap = roundTripped.bootstrapPeers ?? [];
    if (JSON.stringify(origBootstrap) !== JSON.stringify(rtBootstrap))
        return false;
    // webrtc config
    if (JSON.stringify(original.webrtc) !== JSON.stringify(roundTripped.webrtc))
        return false;
    // circuitRelay config
    if (JSON.stringify(original.circuitRelay) !== JSON.stringify(roundTripped.circuitRelay))
        return false;
    return true;
}
/**
 * Feature: kademlia-dht-libp2p, Property 3: Configuration Round-Trip
 *
 * For any valid DHTNodeConfig, serializing then deserializing produces
 * an equivalent configuration.
 *
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
 */
describe('Property 3: Configuration Round-Trip', () => {
    it('serialize then deserialize produces equivalent config for any valid DHTNodeConfig', () => {
        fc.assert(fc.property(dhtNodeConfigArbitrary, (config) => {
            // Serialize the config
            const serialized = serializeConfig(config);
            // Deserialize back to DHTNodeConfig
            const deserialized = deserializeConfig(serialized);
            // Verify equivalence
            expect(configsAreEquivalent(config, deserialized)).toBe(true);
        }), { numRuns: 100 });
    });
    it('double round-trip produces identical serialized output', () => {
        fc.assert(fc.property(dhtNodeConfigArbitrary, (config) => {
            // First round-trip
            const serialized1 = serializeConfig(config);
            const deserialized1 = deserializeConfig(serialized1);
            // Second round-trip
            const serialized2 = serializeConfig(deserialized1);
            // Serialized outputs should be identical
            expect(serialized2).toEqual(serialized1);
        }), { numRuns: 100 });
    });
});
//# sourceMappingURL=config.property.test.js.map