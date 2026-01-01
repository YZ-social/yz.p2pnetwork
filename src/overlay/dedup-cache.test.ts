/**
 * Unit tests for DeduplicationCache
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DeduplicationCache } from './dedup-cache.js';

describe('DeduplicationCache', () => {
  let cache: DeduplicationCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new DeduplicationCache({ ttlMs: 1000 });
  });

  afterEach(() => {
    cache.destroy();
    vi.useRealTimers();
  });

  describe('isDuplicate', () => {
    it('returns false for unseen message IDs', () => {
      expect(cache.isDuplicate('msg-1')).toBe(false);
      expect(cache.isDuplicate('msg-2')).toBe(false);
    });

    it('returns true for previously recorded message IDs', () => {
      cache.record('msg-1', ['peer-a']);
      expect(cache.isDuplicate('msg-1')).toBe(true);
    });

    it('returns false for expired entries', () => {
      cache.record('msg-1', ['peer-a']);
      expect(cache.isDuplicate('msg-1')).toBe(true);

      // Advance time past TTL
      vi.advanceTimersByTime(1001);

      expect(cache.isDuplicate('msg-1')).toBe(false);
    });
  });

  describe('record', () => {
    it('stores message ID with forwarded peers', () => {
      cache.record('msg-1', ['peer-a', 'peer-b']);

      expect(cache.isDuplicate('msg-1')).toBe(true);
      expect(cache.getForwardedPeers('msg-1')).toEqual(['peer-a', 'peer-b']);
    });

    it('stores message ID with empty forwarded peers list', () => {
      cache.record('msg-1', []);

      expect(cache.isDuplicate('msg-1')).toBe(true);
      expect(cache.getForwardedPeers('msg-1')).toEqual([]);
    });

    it('merges forwarded peers when recording same message ID', () => {
      cache.record('msg-1', ['peer-a']);
      cache.record('msg-1', ['peer-b', 'peer-c']);

      const peers = cache.getForwardedPeers('msg-1');
      expect(peers).toContain('peer-a');
      expect(peers).toContain('peer-b');
      expect(peers).toContain('peer-c');
      expect(peers?.length).toBe(3);
    });

    it('deduplicates forwarded peers', () => {
      cache.record('msg-1', ['peer-a', 'peer-b']);
      cache.record('msg-1', ['peer-b', 'peer-c']);

      const peers = cache.getForwardedPeers('msg-1');
      expect(peers?.length).toBe(3);
      expect(peers).toContain('peer-a');
      expect(peers).toContain('peer-b');
      expect(peers).toContain('peer-c');
    });
  });

  describe('getForwardedPeers', () => {
    it('returns undefined for unknown message IDs', () => {
      expect(cache.getForwardedPeers('unknown')).toBeUndefined();
    });

    it('returns forwarded peers for known message IDs', () => {
      cache.record('msg-1', ['peer-a', 'peer-b']);
      expect(cache.getForwardedPeers('msg-1')).toEqual(['peer-a', 'peer-b']);
    });

    it('returns undefined for expired entries', () => {
      cache.record('msg-1', ['peer-a']);

      vi.advanceTimersByTime(1001);

      expect(cache.getForwardedPeers('msg-1')).toBeUndefined();
    });

    it('returns a copy of the forwarded peers array', () => {
      cache.record('msg-1', ['peer-a']);
      const peers1 = cache.getForwardedPeers('msg-1');
      const peers2 = cache.getForwardedPeers('msg-1');

      expect(peers1).toEqual(peers2);
      expect(peers1).not.toBe(peers2); // Different array instances
    });
  });

  describe('cleanup', () => {
    it('removes expired entries', () => {
      cache.record('msg-1', ['peer-a']);
      cache.record('msg-2', ['peer-b']);

      vi.advanceTimersByTime(500);
      cache.record('msg-3', ['peer-c']);

      vi.advanceTimersByTime(501);
      cache.cleanup();

      // msg-1 and msg-2 should be expired
      expect(cache.isDuplicate('msg-1')).toBe(false);
      expect(cache.isDuplicate('msg-2')).toBe(false);
      // msg-3 should still be valid
      expect(cache.isDuplicate('msg-3')).toBe(true);
    });

    it('does nothing when cache is empty', () => {
      cache.cleanup();
      expect(cache.size).toBe(0);
    });

    it('removes all entries when all are expired', () => {
      cache.record('msg-1', ['peer-a']);
      cache.record('msg-2', ['peer-b']);

      vi.advanceTimersByTime(1001);
      cache.cleanup();

      expect(cache.size).toBe(0);
    });
  });

  describe('getStats', () => {
    it('returns zero size and oldest entry for empty cache', () => {
      const stats = cache.getStats();
      expect(stats.size).toBe(0);
      expect(stats.oldestEntry).toBe(0);
    });

    it('returns correct size', () => {
      cache.record('msg-1', ['peer-a']);
      cache.record('msg-2', ['peer-b']);
      cache.record('msg-3', ['peer-c']);

      expect(cache.getStats().size).toBe(3);
    });

    it('returns oldest entry timestamp', () => {
      const startTime = Date.now();
      cache.record('msg-1', ['peer-a']);

      vi.advanceTimersByTime(100);
      cache.record('msg-2', ['peer-b']);

      vi.advanceTimersByTime(100);
      cache.record('msg-3', ['peer-c']);

      const stats = cache.getStats();
      expect(stats.oldestEntry).toBe(startTime);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      cache.record('msg-1', ['peer-a']);
      cache.record('msg-2', ['peer-b']);

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.isDuplicate('msg-1')).toBe(false);
      expect(cache.isDuplicate('msg-2')).toBe(false);
    });
  });

  describe('configuration', () => {
    it('uses default TTL when not specified', () => {
      const defaultCache = new DeduplicationCache();
      expect(defaultCache.ttl).toBe(60000);
      defaultCache.destroy();
    });

    it('uses custom TTL when specified', () => {
      const customCache = new DeduplicationCache({ ttlMs: 5000 });
      expect(customCache.ttl).toBe(5000);
      customCache.destroy();
    });

    it('runs automatic cleanup when interval is specified', () => {
      const autoCleanupCache = new DeduplicationCache({
        ttlMs: 100,
        cleanupIntervalMs: 50,
      });

      autoCleanupCache.record('msg-1', ['peer-a']);
      expect(autoCleanupCache.isDuplicate('msg-1')).toBe(true);

      // Advance past TTL and cleanup interval
      vi.advanceTimersByTime(150);

      // Entry should be cleaned up automatically
      expect(autoCleanupCache.size).toBe(0);

      autoCleanupCache.destroy();
    });
  });

  describe('destroy', () => {
    it('clears the cache and stops cleanup timer', () => {
      const autoCleanupCache = new DeduplicationCache({
        ttlMs: 100,
        cleanupIntervalMs: 50,
      });

      autoCleanupCache.record('msg-1', ['peer-a']);
      autoCleanupCache.destroy();

      expect(autoCleanupCache.size).toBe(0);
    });
  });
});
