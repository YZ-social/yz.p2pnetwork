/**
 * Tests for fast-check generators
 *
 * Validates that generators produce valid outputs
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { uint8ArrayArbitrary, peerIdArbitrary, configArbitrary, minimalConfigArbitrary, dhtKeyArbitrary, dhtValueArbitrary, keyValuePairArbitrary, peerIdArrayArbitrary, listenAddressArbitrary, bootstrapPeerArbitrary, } from './generators.js';
import { validateConfig } from '../dht/config.js';
describe('Test Utility Generators', () => {
    describe('uint8ArrayArbitrary', () => {
        it('generates Uint8Arrays within specified length range', () => {
            fc.assert(fc.property(uint8ArrayArbitrary({ minLength: 10, maxLength: 20 }), (arr) => {
                expect(arr).toBeInstanceOf(Uint8Array);
                expect(arr.length).toBeGreaterThanOrEqual(10);
                expect(arr.length).toBeLessThanOrEqual(20);
            }), { numRuns: 50 });
        });
        it('generates Uint8Arrays with default length range', () => {
            fc.assert(fc.property(uint8ArrayArbitrary(), (arr) => {
                expect(arr).toBeInstanceOf(Uint8Array);
                expect(arr.length).toBeGreaterThanOrEqual(1);
                expect(arr.length).toBeLessThanOrEqual(64);
            }), { numRuns: 50 });
        });
    });
    describe('peerIdArbitrary', () => {
        it('generates 32-byte peer IDs by default', () => {
            fc.assert(fc.property(peerIdArbitrary(), (peerId) => {
                expect(peerId).toBeInstanceOf(Uint8Array);
                expect(peerId.length).toBe(32);
            }), { numRuns: 50 });
        });
        it('generates peer IDs with custom length', () => {
            fc.assert(fc.property(peerIdArbitrary({ length: 48 }), (peerId) => {
                expect(peerId).toBeInstanceOf(Uint8Array);
                expect(peerId.length).toBe(48);
            }), { numRuns: 50 });
        });
    });
    describe('configArbitrary', () => {
        it('generates valid DHTNodeConfig objects', () => {
            fc.assert(fc.property(configArbitrary, (config) => {
                // Should not throw
                expect(() => validateConfig(config)).not.toThrow();
                // Required field must be present
                expect(config.listenAddresses).toBeDefined();
                expect(config.listenAddresses.length).toBeGreaterThanOrEqual(1);
            }), { numRuns: 100 });
        });
        it('generates configs with minConnections <= maxConnections', () => {
            fc.assert(fc.property(configArbitrary, (config) => {
                const maxConn = config.maxConnections ?? 100;
                const minConn = config.minConnections ?? 5;
                expect(minConn).toBeLessThanOrEqual(maxConn);
            }), { numRuns: 100 });
        });
    });
    describe('minimalConfigArbitrary', () => {
        it('generates minimal valid configs', () => {
            fc.assert(fc.property(minimalConfigArbitrary, (config) => {
                expect(() => validateConfig(config)).not.toThrow();
                expect(config.listenAddresses.length).toBeGreaterThanOrEqual(1);
                // Should only have listenAddresses
                expect(config.kBucketSize).toBeUndefined();
                expect(config.alpha).toBeUndefined();
            }), { numRuns: 50 });
        });
    });
    describe('dhtKeyArbitrary', () => {
        it('generates 32-byte keys by default', () => {
            fc.assert(fc.property(dhtKeyArbitrary(), (key) => {
                expect(key).toBeInstanceOf(Uint8Array);
                expect(key.length).toBe(32);
            }), { numRuns: 50 });
        });
    });
    describe('dhtValueArbitrary', () => {
        it('generates values within default range', () => {
            fc.assert(fc.property(dhtValueArbitrary(), (value) => {
                expect(value).toBeInstanceOf(Uint8Array);
                expect(value.length).toBeGreaterThanOrEqual(1);
                expect(value.length).toBeLessThanOrEqual(1024);
            }), { numRuns: 50 });
        });
    });
    describe('keyValuePairArbitrary', () => {
        it('generates valid key-value pairs', () => {
            fc.assert(fc.property(keyValuePairArbitrary, (pair) => {
                expect(pair.key).toBeInstanceOf(Uint8Array);
                expect(pair.value).toBeInstanceOf(Uint8Array);
                expect(pair.key.length).toBe(32);
            }), { numRuns: 50 });
        });
    });
    describe('peerIdArrayArbitrary', () => {
        it('generates arrays of peer IDs', () => {
            fc.assert(fc.property(peerIdArrayArbitrary({ minLength: 5, maxLength: 10 }), (peerIds) => {
                expect(Array.isArray(peerIds)).toBe(true);
                expect(peerIds.length).toBeGreaterThanOrEqual(5);
                expect(peerIds.length).toBeLessThanOrEqual(10);
                for (const peerId of peerIds) {
                    expect(peerId).toBeInstanceOf(Uint8Array);
                    expect(peerId.length).toBe(32);
                }
            }), { numRuns: 50 });
        });
    });
    describe('listenAddressArbitrary', () => {
        it('generates valid multiaddr strings', () => {
            fc.assert(fc.property(listenAddressArbitrary, (addr) => {
                expect(typeof addr).toBe('string');
                expect(addr.startsWith('/')).toBe(true);
            }), { numRuns: 50 });
        });
    });
    describe('bootstrapPeerArbitrary', () => {
        it('generates valid bootstrap peer multiaddrs', () => {
            fc.assert(fc.property(bootstrapPeerArbitrary, (addr) => {
                expect(typeof addr).toBe('string');
                expect(addr.startsWith('/')).toBe(true);
                expect(addr).toContain('/p2p/');
            }), { numRuns: 50 });
        });
    });
});
//# sourceMappingURL=generators.test.js.map