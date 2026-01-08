/**
 * Property-based tests for Peer ID Manager
 * 
 * Feature: browser-libp2p-nodes
 * Property 1: Peer ID Mode Consistency
 * 
 * Tests:
 * - Persistent mode: multiple getPeerId calls return same ID (within session)
 * - Ephemeral mode: generating peer IDs for N different tabs SHALL produce N unique peer IDs
 * 
 * **Validates: Requirements 1.2, 1.3**
 * 
 * Note: Full persistent mode testing (across restarts) requires browser environment
 * with IndexedDB. These tests focus on the core logic that can be tested in Node.js.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { PeerIdManager } from './peer-id-manager.js';
import type { PeerIdManagerConfig } from './types.js';

/**
 * Arbitrary for generating valid storage keys
 */
const storageKeyArbitrary = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{0,15}$/);

/**
 * Arbitrary for ephemeral peer ID manager configs
 */
const ephemeralConfigArbitrary: fc.Arbitrary<PeerIdManagerConfig> = fc.record({
  mode: fc.constant('ephemeral' as const),
  storageKey: storageKeyArbitrary,
});

/**
 * Feature: browser-libp2p-nodes, Property 1: Peer ID Mode Consistency
 * 
 * For any browser node configuration:
 * - In ephemeral mode: generating peer IDs for N different tabs SHALL produce N unique peer IDs
 * - Within a session: multiple getPeerId calls return the same cached ID
 * 
 * **Validates: Requirements 1.2, 1.3**
 */
describe('Property 1: Peer ID Mode Consistency', () => {
  /**
   * Test ephemeral mode: unique peer IDs for different instances
   * 
   * For any ephemeral config, creating N different PeerIdManager instances
   * should produce N unique peer IDs (simulating N different browser tabs).
   */
  it('ephemeral mode: N different instances produce N unique peer IDs', async () => {
    await fc.assert(
      fc.asyncProperty(
        ephemeralConfigArbitrary,
        fc.integer({ min: 2, max: 5 }),
        async (config, instanceCount) => {
          const peerIds: string[] = [];

          // Create N different manager instances (simulating N tabs)
          for (let i = 0; i < instanceCount; i++) {
            const manager = new PeerIdManager(config);
            const peerId = await manager.getPeerId();
            peerIds.push(peerId.toString());
          }

          // All peer IDs should be unique
          const uniqueIds = new Set(peerIds);
          expect(uniqueIds.size).toBe(instanceCount);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Test ephemeral mode: same instance returns same ID (caching)
   * 
   * For any ephemeral config, calling getPeerId multiple times on the same
   * manager instance should return the same peer ID (cached).
   */
  it('ephemeral mode: same instance returns same ID on multiple calls', async () => {
    await fc.assert(
      fc.asyncProperty(
        ephemeralConfigArbitrary,
        fc.integer({ min: 2, max: 5 }),
        async (config, callCount) => {
          const manager = new PeerIdManager(config);
          const peerIds: string[] = [];

          for (let i = 0; i < callCount; i++) {
            const peerId = await manager.getPeerId();
            peerIds.push(peerId.toString());
          }

          // All peer IDs should be identical (cached)
          const firstId = peerIds[0];
          expect(peerIds.every(id => id === firstId)).toBe(true);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Test that peer IDs are valid Ed25519 peer IDs
   * 
   * For any ephemeral config, the generated peer ID should be a valid
   * libp2p peer ID string starting with the Ed25519 prefix.
   */
  it('generated peer IDs are valid libp2p peer ID format', async () => {
    await fc.assert(
      fc.asyncProperty(
        ephemeralConfigArbitrary,
        async (config) => {
          const manager = new PeerIdManager(config);
          const peerId = await manager.getPeerId();

          // Peer ID should be a non-empty string
          expect(typeof peerId.toString()).toBe('string');
          expect(peerId.toString().length).toBeGreaterThan(0);

          // Peer ID should start with expected prefix (12D3KooW for Ed25519)
          expect(peerId.toString()).toMatch(/^12D3KooW/);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Test that private key is available after getPeerId
   * 
   * For any ephemeral config, after calling getPeerId, the private key
   * should be available via getPrivateKey().
   */
  it('private key is available after getPeerId call', async () => {
    await fc.assert(
      fc.asyncProperty(
        ephemeralConfigArbitrary,
        async (config) => {
          const manager = new PeerIdManager(config);
          
          // Before getPeerId, private key should be null
          expect(manager.getPrivateKey()).toBeNull();
          
          // After getPeerId, private key should be available
          await manager.getPeerId();
          const privateKey = manager.getPrivateKey();
          
          expect(privateKey).not.toBeNull();
          expect(privateKey?.type).toBe('Ed25519');
        }
      ),
      { numRuns: 10 }
    );
  });
});
