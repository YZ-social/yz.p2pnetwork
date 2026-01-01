/**
 * Deduplication Cache for Overlay Messaging Network
 *
 * Prevents duplicate message processing and network flooding by tracking
 * seen message IDs with TTL-based expiration.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */

import { DEFAULT_OVERLAY_CONFIG } from './constants.js';

/**
 * Entry stored in the deduplication cache
 */
export interface DeduplicationEntry {
  /** Unique message identifier */
  messageId: string;
  /** Unix timestamp when the message was first seen */
  timestamp: number;
  /** List of peer IDs the message was forwarded to */
  forwardedTo: string[];
}

/**
 * Statistics about the deduplication cache
 */
export interface DeduplicationStats {
  /** Current number of entries in the cache */
  size: number;
  /** Timestamp of the oldest entry (0 if empty) */
  oldestEntry: number;
}

/**
 * Configuration options for the deduplication cache
 */
export interface DeduplicationCacheConfig {
  /** TTL for cache entries in milliseconds (default: 60000) */
  ttlMs?: number;
  /** Interval for automatic cleanup in milliseconds (0 to disable) */
  cleanupIntervalMs?: number;
}

/**
 * Deduplication cache that tracks seen message IDs to prevent duplicate processing.
 *
 * Requirements:
 * - 3.1: WHEN a node receives a message with a message ID it has already seen,
 *        THE Relay_Node SHALL NOT forward the message again
 * - 3.2: WHEN a duplicate message is received, THE Relay_Node SHALL respond
 *        with a DUPLICATE message to the immediate sender only
 * - 3.3: WHEN a message is forwarded, THE Relay_Node SHALL record the message ID
 *        and the peers it was forwarded to
 * - 3.4: WHEN the deduplication cache TTL expires for a message ID,
 *        THE Overlay_Network SHALL remove it from the cache
 * - 3.5: THE Deduplication_Cache TTL SHALL be based on the expected message
 *        propagation time across the network
 */
export class DeduplicationCache {
  private readonly cache: Map<string, DeduplicationEntry>;
  private readonly ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Creates a new DeduplicationCache instance.
   *
   * @param config - Configuration options
   */
  constructor(config: DeduplicationCacheConfig = {}) {
    this.cache = new Map();
    this.ttlMs = config.ttlMs ?? DEFAULT_OVERLAY_CONFIG.dedupeWindowMs;

    // Set up automatic cleanup if interval is specified
    const cleanupInterval = config.cleanupIntervalMs ?? 0;
    if (cleanupInterval > 0) {
      this.cleanupTimer = setInterval(() => this.cleanup(), cleanupInterval);
    }
  }

  /**
   * Checks if a message ID has already been seen.
   *
   * Requirement 3.1: Detect duplicate messages to prevent re-forwarding
   *
   * @param messageId - The message ID to check
   * @returns true if the message is a duplicate (already seen), false otherwise
   */
  isDuplicate(messageId: string): boolean {
    const entry = this.cache.get(messageId);
    if (!entry) {
      return false;
    }

    // Check if the entry has expired
    const now = Date.now();
    if (now - entry.timestamp > this.ttlMs) {
      // Entry has expired, remove it and return false
      this.cache.delete(messageId);
      return false;
    }

    return true;
  }

  /**
   * Records a message as seen and stores the peers it was forwarded to.
   *
   * Requirement 3.3: Record message ID and forwarded peers
   *
   * @param messageId - The message ID to record
   * @param forwardedTo - List of peer IDs the message was forwarded to
   */
  record(messageId: string, forwardedTo: string[]): void {
    const existingEntry = this.cache.get(messageId);

    if (existingEntry) {
      // Update existing entry with additional forwarded peers
      const existingPeers = new Set(existingEntry.forwardedTo);
      for (const peer of forwardedTo) {
        existingPeers.add(peer);
      }
      existingEntry.forwardedTo = Array.from(existingPeers);
    } else {
      // Create new entry
      this.cache.set(messageId, {
        messageId,
        timestamp: Date.now(),
        forwardedTo: [...forwardedTo],
      });
    }
  }

  /**
   * Gets the list of peers a message was forwarded to.
   *
   * Requirement 3.3: Track forwarded peers for duplicate handling
   *
   * @param messageId - The message ID to look up
   * @returns Array of peer IDs the message was forwarded to, or undefined if not found
   */
  getForwardedPeers(messageId: string): string[] | undefined {
    const entry = this.cache.get(messageId);
    if (!entry) {
      return undefined;
    }

    // Check if the entry has expired
    const now = Date.now();
    if (now - entry.timestamp > this.ttlMs) {
      this.cache.delete(messageId);
      return undefined;
    }

    return [...entry.forwardedTo];
  }

  /**
   * Removes expired entries from the cache.
   *
   * Requirement 3.4: Remove entries when TTL expires
   */
  cleanup(): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    for (const [messageId, entry] of this.cache) {
      if (now - entry.timestamp > this.ttlMs) {
        expiredIds.push(messageId);
      }
    }

    for (const messageId of expiredIds) {
      this.cache.delete(messageId);
    }
  }

  /**
   * Gets statistics about the cache.
   *
   * @returns Cache statistics including size and oldest entry timestamp
   */
  getStats(): DeduplicationStats {
    let oldestEntry = 0;

    for (const entry of this.cache.values()) {
      if (oldestEntry === 0 || entry.timestamp < oldestEntry) {
        oldestEntry = entry.timestamp;
      }
    }

    return {
      size: this.cache.size,
      oldestEntry,
    };
  }

  /**
   * Clears all entries from the cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Stops the automatic cleanup timer.
   * Should be called when the cache is no longer needed.
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
  }

  /**
   * Gets the configured TTL in milliseconds.
   */
  get ttl(): number {
    return this.ttlMs;
  }

  /**
   * Gets the current number of entries in the cache.
   */
  get size(): number {
    return this.cache.size;
  }
}
