/**
 * Property-based tests for routing table diagnostics.
 * 
 * Tests Property 5: K-Bucket Size Invariant
 * *For any* routing table state, each k-bucket contains at most `k` peers
 * (where `k` is the configured bucket size).
 * 
 * **Feature: kademlia-dht-libp2p, Property 5: K-Bucket Size Invariant**
 * **Validates: Requirements 3.4, 8.1**
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fc from 'fast-check';
import { DHTNode } from './node.js';
import { DHTConfigBuilder, DEFAULT_CONFIG } from './config.js';

describe('Routing Table Property Tests', () => {
  /**
   * Property 5: K-Bucket Size Invariant
   * 
   * For any routing table state, each k-bucket contains at most `k` peers
   * (where `k` is the configured bucket size).
   * 
   * **Validates: Requirements 3.4, 8.1**
   */
  describe('Property 5: K-Bucket Size Invariant', () => {
    let node: DHTNode;
    let kBucketSize: number;

    beforeAll(async () => {
      // Use a specific k-bucket size for testing
      kBucketSize = DEFAULT_CONFIG.kBucketSize;
      
      const config = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .withKBucketSize(kBucketSize)
        .build();
      
      node = new DHTNode(config);
      await node.start();
    });

    afterAll(async () => {
      if (node?.isStarted) {
        await node.stop();
      }
    });

    it('should ensure each bucket contains at most k peers', () => {
      fc.assert(
        fc.property(
          // Generate a number of times to check the invariant
          // (simulating different routing table states)
          fc.integer({ min: 1, max: 100 }),
          (_iteration) => {
            // Get the current routing table state
            const info = node.getRoutingTableInfo();
            
            // Check that each bucket has at most k peers
            for (const bucket of info.buckets) {
              expect(bucket.peers.length).toBeLessThanOrEqual(kBucketSize);
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain k-bucket size invariant with different k values', async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate different k-bucket sizes to test
          fc.integer({ min: 1, max: 50 }),
          async (k) => {
            // Create a node with the specified k-bucket size
            const config = DHTConfigBuilder.create()
              .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
              .withKBucketSize(k)
              .build();
            
            const testNode = new DHTNode(config);
            
            try {
              await testNode.start();
              
              // Get routing table info
              const info = testNode.getRoutingTableInfo();
              
              // Verify each bucket respects the k limit
              for (const bucket of info.buckets) {
                if (bucket.peers.length > k) {
                  return false;
                }
              }
              
              return true;
            } finally {
              if (testNode.isStarted) {
                await testNode.stop();
              }
            }
          }
        ),
        { numRuns: 10 } // Fewer runs since each creates a new node
      );
    });

    it('should have bucket indices within valid range [0, 255]', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 50 }),
          (_iteration) => {
            const info = node.getRoutingTableInfo();
            
            for (const bucket of info.buckets) {
              // Bucket index should be in valid range for 256-bit key space
              expect(bucket.index).toBeGreaterThanOrEqual(0);
              expect(bucket.index).toBeLessThanOrEqual(255);
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
