/**
 * Pending Requests Manager for Overlay Messaging Network
 *
 * Tracks outgoing requests awaiting responses and handles timeouts.
 * Ensures first-response-wins semantics for redundant message delivery.
 *
 * Requirements: 1.3, 5.4, 8.1
 */

import { DEFAULT_OVERLAY_CONFIG } from './constants.js';
import { OverlayError, OverlayErrorCode } from './errors.js';

/**
 * Represents a pending request awaiting a response
 */
export interface PendingRequest {
  /** Unique message identifier */
  messageId: string;
  /** Peer ID of the target node */
  targetPeerId: string;
  /** Unix timestamp when the request was created */
  timestamp: number;
  /** Timeout duration in milliseconds */
  timeout: number;
  /** Function to resolve the promise with response data */
  resolve: (response: Uint8Array) => void;
  /** Function to reject the promise with an error */
  reject: (error: OverlayError) => void;
}

/**
 * Internal entry stored in the pending requests map
 */
interface PendingEntry {
  request: PendingRequest;
  timerId: ReturnType<typeof setTimeout>;
  resolved: boolean;
}

/**
 * Configuration options for the PendingRequestsManager
 */
export interface PendingRequestsConfig {
  /** Default timeout for requests in milliseconds (default: 30000) */
  defaultTimeout?: number;
  /** Interval for checking timeouts in milliseconds (0 to disable periodic checks) */
  checkIntervalMs?: number;
}

/**
 * Manages pending requests awaiting responses with timeout handling.
 *
 * Requirements:
 * - 1.3: WHEN sendMessage is called with a timeout option, THE Overlay_Network
 *        SHALL reject the promise if no response is received within the timeout period
 * - 5.4: WHEN multiple responses arrive for the same message ID, THE Origin_Node
 *        SHALL accept only the first response
 * - 8.1: WHEN a message times out, THE Overlay_Network SHALL reject with a
 *        TIMEOUT error including the message ID
 */
export class PendingRequestsManager {
  private readonly pending: Map<string, PendingEntry>;
  private readonly defaultTimeout: number;
  private checkTimer: ReturnType<typeof setInterval> | null = null;


  /**
   * Creates a new PendingRequestsManager instance.
   *
   * @param config - Configuration options
   */
  constructor(config: PendingRequestsConfig = {}) {
    this.pending = new Map();
    this.defaultTimeout = config.defaultTimeout ?? DEFAULT_OVERLAY_CONFIG.responseTimeout;

    // Set up periodic timeout checking if interval is specified
    const checkInterval = config.checkIntervalMs ?? 0;
    if (checkInterval > 0) {
      this.checkTimer = setInterval(() => this.checkTimeouts(), checkInterval);
    }
  }

  /**
   * Registers a pending request to track.
   *
   * Requirement 1.3: Track pending requests for timeout handling
   *
   * @param request - The pending request to register
   */
  register(request: PendingRequest): void {
    // If there's already a pending request with this ID, reject the old one
    const existing = this.pending.get(request.messageId);
    if (existing && !existing.resolved) {
      clearTimeout(existing.timerId);
      existing.resolved = true;
      existing.request.reject(
        new OverlayError(
          OverlayErrorCode.DUPLICATE,
          'Request replaced by new request with same message ID',
          { messageId: request.messageId }
        )
      );
    }

    // Set up timeout timer for this request
    const timerId = setTimeout(() => {
      this.handleTimeout(request.messageId);
    }, request.timeout);

    // Store the pending entry
    this.pending.set(request.messageId, {
      request,
      timerId,
      resolved: false,
    });
  }

  /**
   * Resolves a pending request with a response.
   *
   * Requirement 5.4: First response wins - subsequent responses are ignored
   *
   * @param messageId - The message ID to resolve
   * @param response - The response data
   * @returns true if the request was resolved, false if not found or already resolved
   */
  resolve(messageId: string, response: Uint8Array): boolean {
    const entry = this.pending.get(messageId);
    if (!entry || entry.resolved) {
      // Request not found or already resolved (first response wins)
      return false;
    }

    // Mark as resolved and clean up
    entry.resolved = true;
    clearTimeout(entry.timerId);
    this.pending.delete(messageId);

    // Resolve the promise
    entry.request.resolve(response);
    return true;
  }

  /**
   * Rejects a pending request with an error.
   *
   * @param messageId - The message ID to reject
   * @param error - The error to reject with
   * @returns true if the request was rejected, false if not found or already resolved
   */
  reject(messageId: string, error: OverlayError): boolean {
    const entry = this.pending.get(messageId);
    if (!entry || entry.resolved) {
      // Request not found or already resolved
      return false;
    }

    // Mark as resolved and clean up
    entry.resolved = true;
    clearTimeout(entry.timerId);
    this.pending.delete(messageId);

    // Reject the promise
    entry.request.reject(error);
    return true;
  }

  /**
   * Handles timeout for a specific request.
   *
   * Requirement 8.1: Reject with TIMEOUT error including message ID
   *
   * @param messageId - The message ID that timed out
   */
  private handleTimeout(messageId: string): void {
    const entry = this.pending.get(messageId);
    if (!entry || entry.resolved) {
      return;
    }

    // Mark as resolved and clean up
    entry.resolved = true;
    this.pending.delete(messageId);

    // Reject with timeout error
    entry.request.reject(
      new OverlayError(
        OverlayErrorCode.TIMEOUT,
        `Request timed out after ${entry.request.timeout}ms`,
        {
          messageId,
          context: {
            targetPeerId: entry.request.targetPeerId,
            timeout: entry.request.timeout,
          },
        }
      )
    );
  }

  /**
   * Checks all pending requests for timeouts.
   *
   * Requirement 1.3: Handle request timeouts
   *
   * This is useful for periodic cleanup when individual timers might not fire
   * (e.g., in test environments with fake timers).
   */
  checkTimeouts(): void {
    const now = Date.now();
    const timedOut: string[] = [];

    for (const [messageId, entry] of this.pending) {
      if (!entry.resolved) {
        const elapsed = now - entry.request.timestamp;
        if (elapsed >= entry.request.timeout) {
          timedOut.push(messageId);
        }
      }
    }

    // Handle all timed out requests
    for (const messageId of timedOut) {
      this.handleTimeout(messageId);
    }
  }

  /**
   * Gets the number of pending requests.
   *
   * @returns The count of pending (unresolved) requests
   */
  getPendingCount(): number {
    let count = 0;
    for (const entry of this.pending.values()) {
      if (!entry.resolved) {
        count++;
      }
    }
    return count;
  }

  /**
   * Checks if a request is pending.
   *
   * @param messageId - The message ID to check
   * @returns true if the request is pending and not resolved
   */
  isPending(messageId: string): boolean {
    const entry = this.pending.get(messageId);
    return entry !== undefined && !entry.resolved;
  }

  /**
   * Gets the default timeout value.
   */
  get timeout(): number {
    return this.defaultTimeout;
  }

  /**
   * Clears all pending requests without resolving or rejecting them.
   * Use with caution - this will leave promises hanging.
   */
  clear(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timerId);
    }
    this.pending.clear();
  }

  /**
   * Destroys the manager, clearing all pending requests and stopping timers.
   * Rejects all pending requests with a cancellation error.
   */
  destroy(): void {
    // Stop periodic check timer
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }

    // Reject all pending requests
    for (const [messageId, entry] of this.pending) {
      if (!entry.resolved) {
        clearTimeout(entry.timerId);
        entry.resolved = true;
        entry.request.reject(
          new OverlayError(
            OverlayErrorCode.UNREACHABLE,
            'Request cancelled - manager destroyed',
            { messageId }
          )
        );
      }
    }

    this.pending.clear();
  }
}
