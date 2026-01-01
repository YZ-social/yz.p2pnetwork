/**
 * Unit tests for PendingRequestsManager
 *
 * Tests the core functionality of tracking pending requests,
 * resolving/rejecting them, and handling timeouts.
 *
 * Requirements: 1.3, 5.4, 8.1
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PendingRequestsManager, PendingRequest } from './pending-requests.js';
import { OverlayError, OverlayErrorCode } from './errors.js';

describe('PendingRequestsManager', () => {
  let manager: PendingRequestsManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new PendingRequestsManager({ defaultTimeout: 5000 });
  });

  afterEach(() => {
    // Clear without rejecting to avoid unhandled rejections in cleanup
    manager.clear();
    vi.useRealTimers();
  });

  /**
   * Helper to create a pending request with promise
   */
  function createRequest(
    messageId: string,
    timeout = 5000
  ): { request: PendingRequest; promise: Promise<Uint8Array> } {
    let resolve: (response: Uint8Array) => void;
    let reject: (error: OverlayError) => void;

    const promise = new Promise<Uint8Array>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const request: PendingRequest = {
      messageId,
      targetPeerId: 'target-peer-id',
      timestamp: Date.now(),
      timeout,
      resolve: resolve!,
      reject: reject!,
    };

    return { request, promise };
  }

  describe('register', () => {
    it('should register a pending request', () => {
      const { request } = createRequest('msg-1');
      manager.register(request);

      expect(manager.isPending('msg-1')).toBe(true);
      expect(manager.getPendingCount()).toBe(1);
    });

    it('should replace existing request with same message ID', async () => {
      const { request: req1, promise: promise1 } = createRequest('msg-1');
      const { request: req2 } = createRequest('msg-1');

      manager.register(req1);
      manager.register(req2);

      // First request should be rejected
      await expect(promise1).rejects.toMatchObject({
        code: OverlayErrorCode.DUPLICATE,
      });

      // Only one pending request should exist
      expect(manager.getPendingCount()).toBe(1);
    });
  });

  describe('resolve', () => {
    it('should resolve a pending request with response data', async () => {
      const { request, promise } = createRequest('msg-1');
      manager.register(request);

      const response = new Uint8Array([1, 2, 3, 4]);
      const resolved = manager.resolve('msg-1', response);

      expect(resolved).toBe(true);
      expect(manager.isPending('msg-1')).toBe(false);
      await expect(promise).resolves.toEqual(response);
    });

    it('should return false for non-existent message ID', () => {
      const resolved = manager.resolve('non-existent', new Uint8Array([1]));
      expect(resolved).toBe(false);
    });

    it('should return false for already resolved request', async () => {
      const { request, promise } = createRequest('msg-1');
      manager.register(request);

      const response = new Uint8Array([1, 2, 3]);
      manager.resolve('msg-1', response);
      await promise;

      // Second resolve should return false
      const secondResolve = manager.resolve('msg-1', new Uint8Array([4, 5, 6]));
      expect(secondResolve).toBe(false);
    });
  });

  describe('reject', () => {
    it('should reject a pending request with an error', async () => {
      const { request, promise } = createRequest('msg-1');
      manager.register(request);

      const error = new OverlayError(
        OverlayErrorCode.UNREACHABLE,
        'Target not found',
        { messageId: 'msg-1' }
      );
      const rejected = manager.reject('msg-1', error);

      expect(rejected).toBe(true);
      expect(manager.isPending('msg-1')).toBe(false);
      await expect(promise).rejects.toEqual(error);
    });

    it('should return false for non-existent message ID', () => {
      const error = new OverlayError(OverlayErrorCode.UNREACHABLE, 'Error');
      const rejected = manager.reject('non-existent', error);
      expect(rejected).toBe(false);
    });

    it('should return false for already rejected request', async () => {
      const { request, promise } = createRequest('msg-1');
      manager.register(request);

      const error1 = new OverlayError(OverlayErrorCode.UNREACHABLE, 'Error 1');
      manager.reject('msg-1', error1);

      try {
        await promise;
      } catch {
        // Expected
      }

      const error2 = new OverlayError(OverlayErrorCode.UNREACHABLE, 'Error 2');
      const secondReject = manager.reject('msg-1', error2);
      expect(secondReject).toBe(false);
    });
  });

  describe('timeout handling', () => {
    it('should reject request after timeout expires', async () => {
      const { request, promise } = createRequest('msg-1', 1000);
      manager.register(request);

      // Advance time past timeout
      vi.advanceTimersByTime(1001);

      await expect(promise).rejects.toMatchObject({
        code: OverlayErrorCode.TIMEOUT,
        messageId: 'msg-1',
      });

      expect(manager.isPending('msg-1')).toBe(false);
    });

    it('should include timeout duration in error message', async () => {
      const { request, promise } = createRequest('msg-1', 2000);
      manager.register(request);

      vi.advanceTimersByTime(2001);

      await expect(promise).rejects.toMatchObject({
        message: expect.stringContaining('2000ms'),
      });
    });

    it('should not timeout if resolved before timeout', async () => {
      const { request, promise } = createRequest('msg-1', 1000);
      manager.register(request);

      // Resolve before timeout
      vi.advanceTimersByTime(500);
      manager.resolve('msg-1', new Uint8Array([1, 2, 3]));

      // Advance past original timeout
      vi.advanceTimersByTime(600);

      // Should have resolved successfully
      await expect(promise).resolves.toEqual(new Uint8Array([1, 2, 3]));
    });
  });

  describe('checkTimeouts', () => {
    it('should timeout all expired requests', async () => {
      const { request: req1, promise: promise1 } = createRequest('msg-1', 1000);
      const { request: req2, promise: promise2 } = createRequest('msg-2', 2000);
      const { request: req3, promise: promise3 } = createRequest('msg-3', 3000);

      manager.register(req1);
      manager.register(req2);
      manager.register(req3);

      // Advance time to expire first two requests
      vi.advanceTimersByTime(2001);
      manager.checkTimeouts();

      await expect(promise1).rejects.toMatchObject({
        code: OverlayErrorCode.TIMEOUT,
      });
      await expect(promise2).rejects.toMatchObject({
        code: OverlayErrorCode.TIMEOUT,
      });

      // Third request should still be pending
      expect(manager.isPending('msg-3')).toBe(true);

      // Clean up
      vi.advanceTimersByTime(1000);
      await expect(promise3).rejects.toMatchObject({
        code: OverlayErrorCode.TIMEOUT,
      });
    });
  });

  describe('getPendingCount', () => {
    it('should return correct count of pending requests', () => {
      expect(manager.getPendingCount()).toBe(0);

      const { request: req1 } = createRequest('msg-1');
      const { request: req2 } = createRequest('msg-2');

      manager.register(req1);
      expect(manager.getPendingCount()).toBe(1);

      manager.register(req2);
      expect(manager.getPendingCount()).toBe(2);

      manager.resolve('msg-1', new Uint8Array([1]));
      expect(manager.getPendingCount()).toBe(1);
    });
  });

  describe('destroy', () => {
    it('should reject all pending requests on destroy', async () => {
      const { request: req1, promise: promise1 } = createRequest('msg-1');
      const { request: req2, promise: promise2 } = createRequest('msg-2');

      manager.register(req1);
      manager.register(req2);

      manager.destroy();

      await expect(promise1).rejects.toMatchObject({
        code: OverlayErrorCode.UNREACHABLE,
      });
      await expect(promise2).rejects.toMatchObject({
        code: OverlayErrorCode.UNREACHABLE,
      });

      expect(manager.getPendingCount()).toBe(0);
    });
  });
});
