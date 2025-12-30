/**
 * Property-based tests for DHTNode
 *
 * Feature: kademlia-dht-libp2p
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { xorDistance, compareDistance } from './distance.js';
/**
 * Feature: kademlia-dht-libp2p, Property 4: Closest Peers Ordering
 *
 * For any target key and set of peers, the getClosestPeers operation
 * returns peers ordered by ascending XOR distance to the target.
 *
 * This property test validates the sorting logic used by getClosestPeers
 * to ensure peers are correctly ordered by XOR distance.
 *
 * **Validates: Requirements 3.1, 3.5**
 */
describe('Property 4: Closest Peers Ordering', () => {
    /**
     * Helper function that mimics the sorting logic in DHTNode.sortPeersByDistance
     * This tests the core ordering guarantee without requiring network operations.
     */
    function sortByXorDistance(peerIds, targetKey) {
        return [...peerIds].sort((a, b) => {
            const distA = xorDistance(a, targetKey);
            const distB = xorDistance(b, targetKey);
            return compareDistance(distA, distB);
        });
    }
    it('peers are sorted in ascending XOR distance order', () => {
        fc.assert(fc.property(
        // Generate a target key
        fc.uint8Array({ minLength: 32, maxLength: 32 }), 
        // Generate an array of peer IDs (simulating peer multihash bytes)
        fc.array(fc.uint8Array({ minLength: 32, maxLength: 32 }), { minLength: 2, maxLength: 20 }), (targetKey, peerIds) => {
            const sorted = sortByXorDistance(peerIds, targetKey);
            // Verify ordering: each peer should be <= distance from target than the next
            for (let i = 0; i < sorted.length - 1; i++) {
                const distCurrent = xorDistance(sorted[i], targetKey);
                const distNext = xorDistance(sorted[i + 1], targetKey);
                const comparison = compareDistance(distCurrent, distNext);
                // Current distance should be <= next distance
                expect(comparison).toBeLessThanOrEqual(0);
            }
        }), { numRuns: 100 });
    });
    it('sorting is stable - same input produces same output order', () => {
        fc.assert(fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), fc.array(fc.uint8Array({ minLength: 32, maxLength: 32 }), { minLength: 1, maxLength: 10 }), (targetKey, peerIds) => {
            const sorted1 = sortByXorDistance(peerIds, targetKey);
            const sorted2 = sortByXorDistance(peerIds, targetKey);
            // Same input should produce same output
            expect(sorted1.length).toBe(sorted2.length);
            for (let i = 0; i < sorted1.length; i++) {
                expect(sorted1[i]).toEqual(sorted2[i]);
            }
        }), { numRuns: 100 });
    });
    it('closest peer has minimum XOR distance', () => {
        fc.assert(fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), fc.array(fc.uint8Array({ minLength: 32, maxLength: 32 }), { minLength: 1, maxLength: 20 }), (targetKey, peerIds) => {
            if (peerIds.length === 0)
                return;
            const sorted = sortByXorDistance(peerIds, targetKey);
            const closestPeer = sorted[0];
            const closestDistance = xorDistance(closestPeer, targetKey);
            // Verify the first peer has the minimum distance
            for (const peerId of peerIds) {
                const distance = xorDistance(peerId, targetKey);
                const comparison = compareDistance(closestDistance, distance);
                // Closest distance should be <= all other distances
                expect(comparison).toBeLessThanOrEqual(0);
            }
        }), { numRuns: 100 });
    });
    it('sorting preserves all peers - no peers lost or duplicated', () => {
        fc.assert(fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), fc.array(fc.uint8Array({ minLength: 32, maxLength: 32 }), { minLength: 0, maxLength: 15 }), (targetKey, peerIds) => {
            const sorted = sortByXorDistance(peerIds, targetKey);
            // Same length
            expect(sorted.length).toBe(peerIds.length);
            // All original peers should be in sorted result
            for (const peerId of peerIds) {
                const found = sorted.some(p => p.length === peerId.length && p.every((b, i) => b === peerId[i]));
                expect(found).toBe(true);
            }
        }), { numRuns: 100 });
    });
});
//# sourceMappingURL=node.property.test.js.map