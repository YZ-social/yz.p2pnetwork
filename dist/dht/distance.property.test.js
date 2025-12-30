/**
 * Property-based tests for XOR distance utilities
 *
 * Feature: kademlia-dht-libp2p
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { xorDistance, getBucketIndex } from './distance.js';
/**
 * Feature: kademlia-dht-libp2p, Property 1: XOR Distance Symmetry
 *
 * For any two peer IDs a and b, the XOR distance from a to b equals
 * the XOR distance from b to a.
 *
 * **Validates: Requirements 3.4**
 */
describe('Property 1: XOR Distance Symmetry', () => {
    it('xorDistance(a, b) equals xorDistance(b, a) for any byte arrays', () => {
        fc.assert(fc.property(fc.uint8Array({ minLength: 1, maxLength: 64 }), fc.uint8Array({ minLength: 1, maxLength: 64 }), (a, b) => {
            const distanceAB = xorDistance(a, b);
            const distanceBA = xorDistance(b, a);
            // Both distances should be equal
            expect(distanceAB).toEqual(distanceBA);
        }), { numRuns: 100 });
    });
});
/**
 * Feature: kademlia-dht-libp2p, Property 2: Bucket Index Consistency
 *
 * For any local peer ID and remote peer ID, the bucket index calculation
 * is deterministic and falls within valid range [0, 255] (or -1 for identical IDs).
 *
 * **Validates: Requirements 3.4**
 */
describe('Property 2: Bucket Index Consistency', () => {
    it('bucket index is deterministic - same inputs always produce same output', () => {
        fc.assert(fc.property(fc.uint8Array({ minLength: 1, maxLength: 32 }), fc.uint8Array({ minLength: 1, maxLength: 32 }), (localId, peerId) => {
            const index1 = getBucketIndex(localId, peerId);
            const index2 = getBucketIndex(localId, peerId);
            // Same inputs must produce same output
            expect(index1).toBe(index2);
        }), { numRuns: 100 });
    });
    it('bucket index falls within valid range [0, 255] or -1 for identical IDs', () => {
        fc.assert(fc.property(fc.uint8Array({ minLength: 1, maxLength: 32 }), fc.uint8Array({ minLength: 1, maxLength: 32 }), (localId, peerId) => {
            const index = getBucketIndex(localId, peerId);
            // Check if IDs are identical
            const areIdentical = localId.length === peerId.length &&
                localId.every((byte, i) => byte === peerId[i]);
            if (areIdentical) {
                // Identical IDs should return -1
                expect(index).toBe(-1);
            }
            else {
                // Non-identical IDs should return index in [0, 255]
                expect(index).toBeGreaterThanOrEqual(0);
                expect(index).toBeLessThanOrEqual(255);
            }
        }), { numRuns: 100 });
    });
    it('identical IDs always return bucket index -1', () => {
        fc.assert(fc.property(fc.uint8Array({ minLength: 1, maxLength: 32 }), (id) => {
            const index = getBucketIndex(id, id);
            expect(index).toBe(-1);
        }), { numRuns: 100 });
    });
});
//# sourceMappingURL=distance.property.test.js.map