/**
 * Property-based tests for DeduplicationCache
 *
 * Feature: overlay-messaging
 *
 * Tests the correctness properties of the DeduplicationCache class using
 * property-based testing with fast-check.
 *
 * Requirements: 3.1, 3.2, 3.4
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { DeduplicationCache } from './dedup-cache.js';

/**
 * Arbitrary for generating valid message IDs (UUID-like strings)
 */
const messageIdArbitrary = fc.uuid();

/**
 * Arbitrary for generating peer IDs
 */
const peerIdArbitrary = fc.string({ minLength: 10, maxLength: 52 }).filter(
  (s) => s.length > 0 && !s.includes('\0')
);

/**
 * Arbitrary for generating arrays of peer IDs
 */
const peerIdArrayArbitrary = fc.array(peerIdArbitrary, { minLength: 0, maxLength: 10 });

describe('DeduplicationCache Property Tests', () => {
  let cache: DeduplicationCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new DeduplicationCache({ ttlMs: 60000 });
  });

  afterEach(() => {
    cache.destroy();
    vi.useRealTimers();
  });

  /**
   * Feature: overlay-messaging, Property 5: Deduplication Prevents Re-Forwarding
   *
   * *For any* message ID that has been recorded in the deduplication cache,
   * calling `isDuplicate()` with that message ID returns true, and the
   * message is not forwarded again.
   *
   * **Validates: Requirements 3.1, 3.2**
   */
  describe('Property 5: Deduplication Prevents Re-Forwarding', () => {
    it('isDuplicate returns true for any recorded message ID', async () => {
      await fc.assert(
        fc.property(messageIdArbitrary, peerIdArrayArbitrary, (messageId, forwardedTo) => {
          // Record the message
          cache.record(messageId, forwardedTo);

          // isDuplicate should return true
          expect(cache.isDuplicate(messageId)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('isDuplicate returns false for any unrecorded message ID', async () => {
      await fc.assert(
        fc.property(messageIdArbitrary, (messageId) => {
          // Without recording, isDuplicate should return false
          expect(cache.isDuplicate(messageId)).toBe(false);
        }),
        { numRuns: 100 }
      );
    });

    it('recording a message multiple times still marks it as duplicate', async () => {
      await fc.assert(
        fc.property(
          messageIdArbitrary,
          peerIdArrayArbitrary,
          peerIdArrayArbitrary,
          (messageId, peers1, peers2) => {
            // Record the same message ID multiple times
            cache.record(messageId, peers1);
            cache.record(messageId, peers2);

            // Should still be marked as duplicate
            expect(cache.isDuplicate(messageId)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('forwarded peers are preserved after recording', async () => {
      await fc.assert(
        fc.property(messageIdArbitrary, peerIdArrayArbitrary, (messageId, forwardedTo) => {
          cache.record(messageId, forwardedTo);

          const retrievedPeers = cache.getForwardedPeers(messageId);
          expect(retrievedPeers).toBeDefined();

          // All original peers should be in the retrieved list
          for (const peer of forwardedTo) {
            expect(retrievedPeers).toContain(peer);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('multiple recordings merge forwarded peers without duplicates', async () => {
      await fc.assert(
        fc.property(
          messageIdArbitrary,
          peerIdArrayArbitrary,
          peerIdArrayArbitrary,
          (messageId, peers1, peers2) => {
            cache.record(messageId, peers1);
            cache.record(messageId, peers2);

            const retrievedPeers = cache.getForwardedPeers(messageId);
            expect(retrievedPeers).toBeDefined();

            // All peers from both arrays should be present
            const allPeers = new Set([...peers1, ...peers2]);
            expect(retrievedPeers?.length).toBe(allPeers.size);

            for (const peer of allPeers) {
              expect(retrievedPeers).toContain(peer);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Feature: overlay-messaging, Property 15: Deduplication Cache Expiration
   *
   * *For any* message ID recorded in the deduplication cache, after the
   * configured dedupeWindowMs has elapsed, the message ID is no longer
   * in the cache (isDuplicate returns false).
   *
   * **Validates: Requirements 3.4**
   */
  describe('Property 15: Deduplication Cache Expiration', () => {
    it('entries expire after TTL has elapsed', async () => {
      const shortTtlCache = new DeduplicationCache({ ttlMs: 100 });

      try {
        await fc.assert(
          fc.property(messageIdArbitrary, peerIdArrayArbitrary, (messageId, forwardedTo) => {
            // Record the message
            shortTtlCache.record(messageId, forwardedTo);

            // Should be duplicate immediately
            expect(shortTtlCache.isDuplicate(messageId)).toBe(true);

            // Advance time past TTL
            vi.advanceTimersByTime(101);

            // Should no longer be duplicate
            expect(shortTtlCache.isDuplicate(messageId)).toBe(false);

            // Clear for next iteration
            shortTtlCache.clear();
          }),
          { numRuns: 100 }
        );
      } finally {
        shortTtlCache.destroy();
      }
    });

    it('entries remain valid before TTL expires', async () => {
      await fc.assert(
        fc.property(
          messageIdArbitrary,
          peerIdArrayArbitrary,
          fc.integer({ min: 0, max: 99 }),
          (messageId, forwardedTo, timeAdvance) => {
            // Create a fresh cache for each test to avoid timer state issues
            const shortTtlCache = new DeduplicationCache({ ttlMs: 100 });

            try {
              // Record the message
              shortTtlCache.record(messageId, forwardedTo);

              // Advance time but stay within TTL
              vi.advanceTimersByTime(timeAdvance);

              // Should still be duplicate
              expect(shortTtlCache.isDuplicate(messageId)).toBe(true);
            } finally {
              shortTtlCache.destroy();
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('cleanup removes all expired entries', async () => {
      const shortTtlCache = new DeduplicationCache({ ttlMs: 100 });

      try {
        await fc.assert(
          fc.property(
            fc.array(messageIdArbitrary, { minLength: 1, maxLength: 20 }),
            (messageIds) => {
              // Record all messages
              for (const messageId of messageIds) {
                shortTtlCache.record(messageId, []);
              }

              // Advance time past TTL
              vi.advanceTimersByTime(101);

              // Run cleanup
              shortTtlCache.cleanup();

              // All entries should be removed
              expect(shortTtlCache.size).toBe(0);

              // All messages should no longer be duplicates
              for (const messageId of messageIds) {
                expect(shortTtlCache.isDuplicate(messageId)).toBe(false);
              }
            }
          ),
          { numRuns: 100 }
        );
      } finally {
        shortTtlCache.destroy();
      }
    });

    it('getForwardedPeers returns undefined for expired entries', async () => {
      const shortTtlCache = new DeduplicationCache({ ttlMs: 100 });

      try {
        await fc.assert(
          fc.property(messageIdArbitrary, peerIdArrayArbitrary, (messageId, forwardedTo) => {
            // Record the message
            shortTtlCache.record(messageId, forwardedTo);

            // Should have forwarded peers immediately
            expect(shortTtlCache.getForwardedPeers(messageId)).toBeDefined();

            // Advance time past TTL
            vi.advanceTimersByTime(101);

            // Should return undefined after expiration
            expect(shortTtlCache.getForwardedPeers(messageId)).toBeUndefined();

            // Clear for next iteration
            shortTtlCache.clear();
          }),
          { numRuns: 100 }
        );
      } finally {
        shortTtlCache.destroy();
      }
    });
  });
});
