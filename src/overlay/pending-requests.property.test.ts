/**
 * Property-based tests for PendingRequestsManager
 *
 * Feature: overlay-messaging
 *
 * Tests the correctness properties of the PendingRequestsManager class using
 * property-based testing with fast-check.
 *
 * Requirements: 1.3, 5.4, 8.1
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { PendingRequestsManager, PendingRequest } from './pending-requests.js';
import { OverlayErrorCode } from './errors.js';

/**
 * Arbitrary for generating valid message IDs (UUID-like strings)
 */
const messageIdArbitrary = fc.uuid();

/**
 * Arbitrary for generating peer IDs
 */
const peerIdArbitrary = fc
  .string({ minLength: 10, maxLength: 52 })
  .filter((s) => s.length > 0 && !s.includes('\0'));

/**
 * Arbitrary for generating response payloads
 */
const responseArbitrary = fc.uint8Array({ minLength: 1, maxLength: 1024 });

/**
 * Arbitrary for generating timeout values (reasonable range)
 */
const timeoutArbitrary = fc.integer({ min: 100, max: 60000 });

/**
 * Helper to create a pending request with promise
 */
function createRequest(
  messageId: string,
  targetPeerId: string,
  timeout: number
): { request: PendingRequest; promise: Promise<Uint8Array> } {
  let resolve: (response: Uint8Array) => void;
  let reject: (error: Error) => void;

  const promise = new Promise<Uint8Array>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const request: PendingRequest = {
    messageId,
    targetPeerId,
    timestamp: Date.now(),
    timeout,
    resolve: resolve!,
    reject: reject!,
  };

  return { request, promise };
}

describe('PendingRequestsManager Property Tests', () => {
  let manager: PendingRequestsManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new PendingRequestsManager({ defaultTimeout: 30000 });
  });

  afterEach(() => {
    manager.clear();
    vi.useRealTimers();
  });

  /**
   * Feature: overlay-messaging, Property 8: First Response Wins
   *
   * *For any* message ID with a pending request, when multiple responses arrive,
   * only the first response resolves the promise; subsequent responses for the
   * same message ID are ignored.
   *
   * **Validates: Requirements 5.4**
   */
  describe('Property 8: First Response Wins', () => {
    it('only the first response resolves the promise', async () => {
      await fc.assert(
        fc.asyncProperty(
          messageIdArbitrary,
          peerIdArbitrary,
          timeoutArbitrary,
          responseArbitrary,
          responseArbitrary,
          async (messageId, targetPeerId, timeout, response1, response2) => {
            // Create and register a pending request
            const { request, promise } = createRequest(messageId, targetPeerId, timeout);
            manager.register(request);

            // First response should succeed
            const firstResolved = manager.resolve(messageId, response1);
            expect(firstResolved).toBe(true);

            // Second response should be ignored
            const secondResolved = manager.resolve(messageId, response2);
            expect(secondResolved).toBe(false);

            // Promise should resolve with first response
            const result = await promise;
            expect(result).toEqual(response1);

            // Clean up for next iteration
            manager.clear();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('subsequent responses after first are always ignored regardless of count', async () => {
      await fc.assert(
        fc.asyncProperty(
          messageIdArbitrary,
          peerIdArbitrary,
          timeoutArbitrary,
          fc.array(responseArbitrary, { minLength: 2, maxLength: 10 }),
          async (messageId, targetPeerId, timeout, responses) => {
            // Create and register a pending request
            const { request, promise } = createRequest(messageId, targetPeerId, timeout);
            manager.register(request);

            // First response should succeed
            const firstResolved = manager.resolve(messageId, responses[0]);
            expect(firstResolved).toBe(true);

            // All subsequent responses should be ignored
            for (let i = 1; i < responses.length; i++) {
              const resolved = manager.resolve(messageId, responses[i]);
              expect(resolved).toBe(false);
            }

            // Promise should resolve with first response only
            const result = await promise;
            expect(result).toEqual(responses[0]);

            // Clean up for next iteration
            manager.clear();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('request is no longer pending after first response', async () => {
      await fc.assert(
        fc.asyncProperty(
          messageIdArbitrary,
          peerIdArbitrary,
          timeoutArbitrary,
          responseArbitrary,
          async (messageId, targetPeerId, timeout, response) => {
            // Create and register a pending request
            const { request, promise } = createRequest(messageId, targetPeerId, timeout);
            manager.register(request);

            // Should be pending before response
            expect(manager.isPending(messageId)).toBe(true);

            // Resolve with first response
            manager.resolve(messageId, response);
            await promise;

            // Should no longer be pending after response
            expect(manager.isPending(messageId)).toBe(false);

            // Clean up for next iteration
            manager.clear();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('pending count decreases by exactly one after first response', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              messageId: messageIdArbitrary,
              targetPeerId: peerIdArbitrary,
              timeout: timeoutArbitrary,
            }),
            { minLength: 1, maxLength: 10 }
          ).filter((arr) => {
            // Ensure unique message IDs
            const ids = arr.map((r) => r.messageId);
            return new Set(ids).size === ids.length;
          }),
          responseArbitrary,
          async (requestConfigs, response) => {
            const requests: Array<{ request: PendingRequest; promise: Promise<Uint8Array> }> = [];

            // Register all requests
            for (const config of requestConfigs) {
              const req = createRequest(config.messageId, config.targetPeerId, config.timeout);
              manager.register(req.request);
              requests.push(req);
            }

            const initialCount = manager.getPendingCount();
            expect(initialCount).toBe(requestConfigs.length);

            // Resolve first request
            const firstMessageId = requestConfigs[0].messageId;
            manager.resolve(firstMessageId, response);
            await requests[0].promise;

            // Count should decrease by exactly one
            expect(manager.getPendingCount()).toBe(initialCount - 1);

            // Clean up for next iteration
            manager.clear();
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  /**
   * Feature: overlay-messaging, Property 10: Timeout Behavior
   *
   * *For any* sendMessage call with a timeout option, if no response is received
   * within the timeout period, the promise rejects with a TIMEOUT error containing
   * the message ID.
   *
   * **Validates: Requirements 1.3, 8.1**
   */
  describe('Property 10: Timeout Behavior', () => {
    it('request times out after specified timeout period', async () => {
      await fc.assert(
        fc.asyncProperty(
          messageIdArbitrary,
          peerIdArbitrary,
          fc.integer({ min: 100, max: 5000 }),
          async (messageId, targetPeerId, timeout) => {
            // Create and register a pending request
            const { request, promise } = createRequest(messageId, targetPeerId, timeout);
            manager.register(request);

            // Advance time past timeout
            vi.advanceTimersByTime(timeout + 1);

            // Promise should reject with TIMEOUT error
            await expect(promise).rejects.toMatchObject({
              code: OverlayErrorCode.TIMEOUT,
              messageId: messageId,
            });

            // Clean up for next iteration
            manager.clear();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('request does not timeout before specified timeout period', async () => {
      await fc.assert(
        fc.asyncProperty(
          messageIdArbitrary,
          peerIdArbitrary,
          fc.integer({ min: 200, max: 5000 }),
          fc.integer({ min: 0, max: 99 }).map((pct) => pct / 100), // 0-99% of timeout
          responseArbitrary,
          async (messageId, targetPeerId, timeout, timePercent, response) => {
            // Create and register a pending request
            const { request, promise } = createRequest(messageId, targetPeerId, timeout);
            manager.register(request);

            // Advance time but stay within timeout
            const timeAdvance = Math.floor(timeout * timePercent);
            vi.advanceTimersByTime(timeAdvance);

            // Request should still be pending
            expect(manager.isPending(messageId)).toBe(true);

            // Resolve the request
            manager.resolve(messageId, response);

            // Promise should resolve successfully
            const result = await promise;
            expect(result).toEqual(response);

            // Clean up for next iteration
            manager.clear();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('timeout error includes the message ID', async () => {
      await fc.assert(
        fc.asyncProperty(
          messageIdArbitrary,
          peerIdArbitrary,
          fc.integer({ min: 100, max: 1000 }),
          async (messageId, targetPeerId, timeout) => {
            // Create and register a pending request
            const { request, promise } = createRequest(messageId, targetPeerId, timeout);
            manager.register(request);

            // Advance time past timeout
            vi.advanceTimersByTime(timeout + 1);

            // Catch the error and verify it contains the message ID
            try {
              await promise;
              // Should not reach here
              expect.fail('Promise should have rejected');
            } catch (error: unknown) {
              expect(error).toMatchObject({
                code: OverlayErrorCode.TIMEOUT,
                messageId: messageId,
              });
            }

            // Clean up for next iteration
            manager.clear();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('checkTimeouts correctly identifies and times out expired requests', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              messageId: messageIdArbitrary,
              targetPeerId: peerIdArbitrary,
              // Use same timeout for all requests to avoid unhandled rejections
              timeout: fc.constant(500),
            }),
            { minLength: 1, maxLength: 5 }
          ).filter((arr) => {
            // Ensure unique message IDs
            const ids = arr.map((r) => r.messageId);
            return new Set(ids).size === ids.length;
          }),
          async (requestConfigs) => {
            const requests: Array<{
              config: { messageId: string; targetPeerId: string; timeout: number };
              request: PendingRequest;
              promise: Promise<Uint8Array>;
            }> = [];

            // Register all requests
            for (const config of requestConfigs) {
              const req = createRequest(config.messageId, config.targetPeerId, config.timeout);
              manager.register(req.request);
              requests.push({ config, ...req });
            }

            // Advance time past all timeouts
            vi.advanceTimersByTime(501);

            // Call checkTimeouts to process expired requests
            manager.checkTimeouts();

            // Verify that all requests have timed out
            for (const { promise } of requests) {
              await expect(promise).rejects.toMatchObject({
                code: OverlayErrorCode.TIMEOUT,
              });
            }

            // Clean up for next iteration
            manager.clear();
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
