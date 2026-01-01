/**
 * Property-based tests for KeyManager
 *
 * Feature: overlay-messaging
 *
 * Tests the correctness properties of the KeyManager class using
 * property-based testing with fast-check.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  KeyManager,
  PublicKeyCache,
  InMemoryKeyStorage,
} from './key-manager.js';
import { HybridCrypto } from './crypto.js';
import type { HybridPublicKey } from './types.js';

// Shared crypto instance
const crypto = new HybridCrypto();

/**
 * Arbitrary for generating valid peer IDs
 * Peer IDs are typically base58-encoded strings
 */
const peerIdArbitrary = fc.string({ minLength: 10, maxLength: 60 })
  .filter(s => s.length > 0 && !s.includes('\0'));

/**
 * Arbitrary for generating valid hybrid public keys
 */
const hybridPublicKeyArbitrary = fc.record({
  x25519: fc.uint8Array({ minLength: 32, maxLength: 32 }),
  mlkem768: fc.uint8Array({ minLength: 1184, maxLength: 1184 }),
});

/**
 * Mock DHT for testing key publication and lookup
 */
class MockDHT {
  private storage: Map<string, Uint8Array> = new Map();

  async put(key: Uint8Array, value: Uint8Array): Promise<void> {
    const keyStr = new TextDecoder().decode(key);
    this.storage.set(keyStr, new Uint8Array(value));
  }

  async get(key: Uint8Array): Promise<Uint8Array> {
    const keyStr = new TextDecoder().decode(key);
    const value = this.storage.get(keyStr);
    if (!value) {
      throw new Error('Key not found in DHT');
    }
    return value;
  }

  clear(): void {
    this.storage.clear();
  }
}

/**
 * Feature: overlay-messaging, Property 3: Public Key DHT Round-Trip
 *
 * *For any* valid HybridPublicKey, publishing to the DHT then looking up
 * by peer ID returns an equivalent public key.
 *
 * **Validates: Requirements 10.3, 10.4**
 */
describe('Property 3: Public Key DHT Round-Trip', () => {
  let mockDHT: MockDHT;

  beforeEach(() => {
    mockDHT = new MockDHT();
  });

  it('publishing then looking up a public key returns equivalent key', async () => {
    await fc.assert(
      fc.asyncProperty(peerIdArbitrary, async (peerId) => {
        // Create a key manager and initialize with generated keys
        const storage = new InMemoryKeyStorage();
        const keyManager = new KeyManager({ storage, crypto });
        await keyManager.initialize();

        // Set up mock DHT
        keyManager.setDHT(mockDHT as unknown as import('../dht/node.js').DHTNode, peerId);

        // Get the original public key
        const originalPublicKey = keyManager.getPublicKey();

        // Publish to DHT
        await keyManager.publishPublicKey();

        // Create a new key manager to lookup the key
        const lookupManager = new KeyManager({ storage: new InMemoryKeyStorage(), crypto });
        await lookupManager.initialize();
        lookupManager.setDHT(mockDHT as unknown as import('../dht/node.js').DHTNode, 'other-peer');

        // Lookup the published key
        const retrievedPublicKey = await lookupManager.lookupPublicKey(peerId);

        // Verify round-trip produces equivalent public key
        expect(retrievedPublicKey.x25519).toEqual(originalPublicKey.x25519);
        expect(retrievedPublicKey.mlkem768).toEqual(originalPublicKey.mlkem768);
      }),
      { numRuns: 100 }
    );
  });

  it('multiple peers can publish and lookup each others keys', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(peerIdArbitrary, { minLength: 2, maxLength: 5 }),
        async (peerIds) => {
          // Filter out duplicate peer IDs
          const uniquePeerIds = [...new Set(peerIds)];
          if (uniquePeerIds.length < 2) return; // Skip if not enough unique peers

          const managers: KeyManager[] = [];
          const publicKeys: Map<string, HybridPublicKey> = new Map();

          // Initialize and publish keys for each peer
          for (const peerId of uniquePeerIds) {
            const manager = new KeyManager({
              storage: new InMemoryKeyStorage(),
              crypto,
            });
            await manager.initialize();
            manager.setDHT(mockDHT as unknown as import('../dht/node.js').DHTNode, peerId);
            await manager.publishPublicKey();

            managers.push(manager);
            publicKeys.set(peerId, manager.getPublicKey());
          }

          // Each peer should be able to lookup other peers' keys
          for (let i = 0; i < uniquePeerIds.length; i++) {
            for (let j = 0; j < uniquePeerIds.length; j++) {
              if (i !== j) {
                const lookupPeerId = uniquePeerIds[j];
                const expectedKey = publicKeys.get(lookupPeerId)!;
                const retrievedKey = await managers[i].lookupPublicKey(lookupPeerId);

                expect(retrievedKey.x25519).toEqual(expectedKey.x25519);
                expect(retrievedKey.mlkem768).toEqual(expectedKey.mlkem768);
              }
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  it('looked up keys are cached and returned on subsequent lookups', async () => {
    await fc.assert(
      fc.asyncProperty(peerIdArbitrary, async (peerId) => {
        // Create and publish a key
        const publisherManager = new KeyManager({
          storage: new InMemoryKeyStorage(),
          crypto,
        });
        await publisherManager.initialize();
        publisherManager.setDHT(mockDHT as unknown as import('../dht/node.js').DHTNode, peerId);
        await publisherManager.publishPublicKey();

        const originalPublicKey = publisherManager.getPublicKey();

        // Create a lookup manager
        const lookupManager = new KeyManager({
          storage: new InMemoryKeyStorage(),
          crypto,
          cacheTTL: 60000, // 1 minute cache
        });
        await lookupManager.initialize();
        lookupManager.setDHT(mockDHT as unknown as import('../dht/node.js').DHTNode, 'lookup-peer');

        // First lookup - should hit DHT
        const firstLookup = await lookupManager.lookupPublicKey(peerId);
        expect(firstLookup.x25519).toEqual(originalPublicKey.x25519);

        // Clear DHT to ensure second lookup uses cache
        mockDHT.clear();

        // Second lookup - should use cache
        const secondLookup = await lookupManager.lookupPublicKey(peerId);
        expect(secondLookup.x25519).toEqual(originalPublicKey.x25519);
        expect(secondLookup.mlkem768).toEqual(originalPublicKey.mlkem768);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Additional property tests for PublicKeyCache
 */
describe('PublicKeyCache Properties', () => {
  it('cached keys are retrievable before TTL expires', async () => {
    await fc.assert(
      fc.asyncProperty(
        peerIdArbitrary,
        hybridPublicKeyArbitrary,
        fc.integer({ min: 100, max: 10000 }),
        async (peerId, publicKey, ttlMs) => {
          const cache = new PublicKeyCache(ttlMs);
          cache.set(peerId, publicKey);

          // Immediately after setting, key should be retrievable
          const retrieved = cache.get(peerId);
          expect(retrieved).toBeDefined();
          expect(retrieved!.x25519).toEqual(publicKey.x25519);
          expect(retrieved!.mlkem768).toEqual(publicKey.mlkem768);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('invalidated keys are not retrievable', async () => {
    await fc.assert(
      fc.asyncProperty(
        peerIdArbitrary,
        hybridPublicKeyArbitrary,
        async (peerId, publicKey) => {
          const cache = new PublicKeyCache(60000);
          cache.set(peerId, publicKey);
          cache.invalidate(peerId);

          const retrieved = cache.get(peerId);
          expect(retrieved).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('clear removes all cached keys', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(peerIdArbitrary, hybridPublicKeyArbitrary), { minLength: 1, maxLength: 10 }),
        async (entries) => {
          const cache = new PublicKeyCache(60000);

          // Add all entries
          for (const [peerId, publicKey] of entries) {
            cache.set(peerId, publicKey);
          }

          // Clear the cache
          cache.clear();

          // All entries should be gone
          expect(cache.size).toBe(0);
          for (const [peerId] of entries) {
            expect(cache.get(peerId)).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
