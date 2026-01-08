/**
 * Relay Selector for Browser Nodes
 * 
 * Manages relay node discovery, selection, and failover for browser nodes
 * that need circuit relay for NAT traversal.
 * 
 * Features:
 * - Discovers relay nodes from DHT or configuration
 * - Selects least loaded relay based on utilization
 * - Handles RESOURCE_LIMIT_EXCEEDED with automatic retry
 * - Supports graceful degradation when all relays are full
 * 
 * Requirements: 10.2, 10.3, 10.4, 10.5, 11.1, 11.3
 */

import type { RelayNodeInfo, RelayStatus } from './types.js';

/**
 * Error code returned when a relay is at capacity
 */
export const RESOURCE_LIMIT_EXCEEDED = 'RESOURCE_LIMIT_EXCEEDED';

/**
 * Configuration for relay selector
 */
export interface RelaySelectorConfig {
  /** Maximum utilization threshold (0-1) for relay selection (default: 0.95) */
  maxUtilizationThreshold: number;
  /** How long to cache relay status before refreshing (ms) (default: 30000) */
  statusCacheTTL: number;
  /** Maximum number of relay retry attempts (default: 3) */
  maxRetryAttempts: number;
  /** Callback to fetch relay status from a relay node */
  fetchRelayStatus?: (peerId: string, multiaddrs: string[]) => Promise<RelayStatus>;
}

/**
 * Default relay selector configuration
 */
export const DEFAULT_RELAY_SELECTOR_CONFIG: RelaySelectorConfig = {
  maxUtilizationThreshold: 0.95,
  statusCacheTTL: 30000,
  maxRetryAttempts: 3,
};

/**
 * Result of a relay selection attempt
 */
export interface RelaySelectionResult {
  /** Selected relay peer ID, or null if none available */
  peerId: string | null;
  /** Multiaddrs of the selected relay */
  multiaddrs: string[];
  /** Whether this was a fallback selection (all preferred relays full) */
  isFallback: boolean;
  /** Number of relays that were at capacity */
  relaysAtCapacity: number;
  /** Total number of known relays */
  totalRelays: number;
}

/**
 * Result of a relay request attempt
 */
export interface RelayRequestResult {
  /** Whether the request succeeded */
  success: boolean;
  /** Error code if failed */
  errorCode?: string;
  /** Error message if failed */
  errorMessage?: string;
  /** The relay peer ID that was attempted */
  relayPeerId: string;
}

/**
 * Event types emitted by RelaySelector
 */
export type RelaySelectorEvent = 
  | { type: 'relay-selected'; peerId: string; utilization: number }
  | { type: 'relay-failed'; peerId: string; errorCode: string }
  | { type: 'all-relays-full'; relayCount: number }
  | { type: 'relay-status-updated'; peerId: string; utilization: number }
  | { type: 'degraded-mode'; directPeersOnly: boolean };

/**
 * Callback type for relay selector events
 */
export type RelaySelectorEventHandler = (event: RelaySelectorEvent) => void;

/**
 * Manages relay node selection and failover for browser nodes
 */
export class RelaySelector {
  private relayNodes: Map<string, RelayNodeInfo> = new Map();
  private failedRelays: Set<string> = new Set();
  private config: RelaySelectorConfig;
  private eventHandlers: RelaySelectorEventHandler[] = [];
  private inDegradedMode = false;

  constructor(config: Partial<RelaySelectorConfig> = {}) {
    this.config = {
      ...DEFAULT_RELAY_SELECTOR_CONFIG,
      ...config,
    };
  }

  /**
   * Add a relay node to the known relays
   */
  addRelay(info: RelayNodeInfo): void {
    this.relayNodes.set(info.peerId, {
      ...info,
      lastUpdated: Date.now(),
    });
    // Clear from failed set if it was previously failed
    this.failedRelays.delete(info.peerId);
  }

  /**
   * Add multiple relay nodes from configuration
   */
  addRelaysFromConfig(relays: Array<{ peerId: string; multiaddrs: string[] }>): void {
    for (const relay of relays) {
      this.addRelay({
        peerId: relay.peerId,
        multiaddrs: relay.multiaddrs,
        utilization: 0, // Unknown, will be updated on first status fetch
        lastUpdated: 0, // Force status refresh
      });
    }
  }

  /**
   * Remove a relay node from the known relays
   */
  removeRelay(peerId: string): void {
    this.relayNodes.delete(peerId);
    this.failedRelays.delete(peerId);
  }

  /**
   * Get all known relay nodes
   */
  getRelays(): RelayNodeInfo[] {
    return Array.from(this.relayNodes.values());
  }

  /**
   * Get the number of known relay nodes
   */
  getRelayCount(): number {
    return this.relayNodes.size;
  }

  /**
   * Check if the selector is in degraded mode (all relays full)
   */
  isInDegradedMode(): boolean {
    return this.inDegradedMode;
  }

  /**
   * Select the best available relay node
   * 
   * Selection criteria:
   * 1. Filter out relays above utilization threshold
   * 2. Filter out recently failed relays
   * 3. Sort by utilization (least loaded first)
   * 4. Return the least loaded relay
   * 
   * @returns Selection result with relay info or null if none available
   */
  selectRelay(): RelaySelectionResult {
    const now = Date.now();
    const availableRelays: RelayNodeInfo[] = [];
    let relaysAtCapacity = 0;

    for (const relay of this.relayNodes.values()) {
      // Skip recently failed relays
      if (this.failedRelays.has(relay.peerId)) {
        relaysAtCapacity++;
        continue;
      }

      // Skip relays above utilization threshold
      if (relay.utilization >= this.config.maxUtilizationThreshold) {
        relaysAtCapacity++;
        continue;
      }

      availableRelays.push(relay);
    }

    // Sort by utilization (least loaded first)
    availableRelays.sort((a, b) => a.utilization - b.utilization);

    const totalRelays = this.relayNodes.size;

    if (availableRelays.length === 0) {
      // All relays at capacity - enter degraded mode
      if (!this.inDegradedMode) {
        this.inDegradedMode = true;
        this.emit({ type: 'all-relays-full', relayCount: totalRelays });
        this.emit({ type: 'degraded-mode', directPeersOnly: true });
      }

      return {
        peerId: null,
        multiaddrs: [],
        isFallback: false,
        relaysAtCapacity,
        totalRelays,
      };
    }

    // Exit degraded mode if we have available relays
    if (this.inDegradedMode) {
      this.inDegradedMode = false;
      this.emit({ type: 'degraded-mode', directPeersOnly: false });
    }

    const selected = availableRelays[0];
    this.emit({ 
      type: 'relay-selected', 
      peerId: selected.peerId, 
      utilization: selected.utilization 
    });

    return {
      peerId: selected.peerId,
      multiaddrs: selected.multiaddrs,
      isFallback: relaysAtCapacity > 0,
      relaysAtCapacity,
      totalRelays,
    };
  }

  /**
   * Select an alternative relay, excluding the specified peer IDs
   * 
   * Used for failover when a relay request fails
   */
  selectAlternativeRelay(excludePeerIds: string[]): RelaySelectionResult {
    const excludeSet = new Set(excludePeerIds);
    const availableRelays: RelayNodeInfo[] = [];
    let relaysAtCapacity = 0;

    for (const relay of this.relayNodes.values()) {
      // Skip excluded relays
      if (excludeSet.has(relay.peerId)) {
        continue;
      }

      // Skip recently failed relays
      if (this.failedRelays.has(relay.peerId)) {
        relaysAtCapacity++;
        continue;
      }

      // Skip relays above utilization threshold
      if (relay.utilization >= this.config.maxUtilizationThreshold) {
        relaysAtCapacity++;
        continue;
      }

      availableRelays.push(relay);
    }

    // Sort by utilization (least loaded first)
    availableRelays.sort((a, b) => a.utilization - b.utilization);

    const totalRelays = this.relayNodes.size;

    if (availableRelays.length === 0) {
      return {
        peerId: null,
        multiaddrs: [],
        isFallback: false,
        relaysAtCapacity: relaysAtCapacity + excludePeerIds.length,
        totalRelays,
      };
    }

    const selected = availableRelays[0];
    return {
      peerId: selected.peerId,
      multiaddrs: selected.multiaddrs,
      isFallback: true,
      relaysAtCapacity,
      totalRelays,
    };
  }

  /**
   * Handle a relay request result
   * 
   * If the request failed with RESOURCE_LIMIT_EXCEEDED, marks the relay
   * as failed and returns whether retry should be attempted.
   * 
   * @returns true if retry should be attempted with alternative relay
   */
  handleRelayResult(result: RelayRequestResult): boolean {
    if (result.success) {
      // Clear from failed set on success
      this.failedRelays.delete(result.relayPeerId);
      return false;
    }

    if (result.errorCode === RESOURCE_LIMIT_EXCEEDED) {
      // Mark relay as failed (at capacity)
      this.failedRelays.add(result.relayPeerId);
      this.emit({ 
        type: 'relay-failed', 
        peerId: result.relayPeerId, 
        errorCode: result.errorCode 
      });

      // Update utilization to max
      const relay = this.relayNodes.get(result.relayPeerId);
      if (relay) {
        relay.utilization = 1.0;
        relay.lastUpdated = Date.now();
      }

      // Check if there are alternative relays available
      const alternatives = this.selectAlternativeRelay([result.relayPeerId]);
      return alternatives.peerId !== null;
    }

    // Other errors - don't retry automatically
    return false;
  }

  /**
   * Attempt to connect through a relay with automatic failover
   * 
   * This method implements the retry logic for RESOURCE_LIMIT_EXCEEDED:
   * 1. Select the best available relay
   * 2. Attempt connection through the relay
   * 3. If RESOURCE_LIMIT_EXCEEDED, try alternative relays
   * 4. Continue until success or max retries reached
   * 
   * @param requestRelay - Function to request relay connection
   * @returns Final result after all retry attempts
   */
  async requestRelayWithFailover(
    requestRelay: (peerId: string, multiaddrs: string[]) => Promise<RelayRequestResult>
  ): Promise<{ success: boolean; result?: RelayRequestResult; attemptedRelays: string[] }> {
    const attemptedRelays: string[] = [];
    let attempts = 0;

    while (attempts < this.config.maxRetryAttempts) {
      const selection = this.selectAlternativeRelay(attemptedRelays);
      
      if (selection.peerId === null) {
        // No more relays available
        break;
      }

      attemptedRelays.push(selection.peerId);
      attempts++;

      const result = await requestRelay(selection.peerId, selection.multiaddrs);
      
      if (result.success) {
        return { success: true, result, attemptedRelays };
      }

      const shouldRetry = this.handleRelayResult(result);
      if (!shouldRetry) {
        // Error is not retryable
        return { success: false, result, attemptedRelays };
      }

      // Continue to next iteration for retry
    }

    // All retries exhausted
    return { success: false, attemptedRelays };
  }

  /**
   * Update the status of a relay node
   */
  async updateRelayStatus(peerId: string): Promise<void> {
    const relay = this.relayNodes.get(peerId);
    if (!relay) {
      return;
    }

    // Check if status is still fresh
    const now = Date.now();
    if (now - relay.lastUpdated < this.config.statusCacheTTL) {
      return;
    }

    if (!this.config.fetchRelayStatus) {
      return;
    }

    try {
      const status = await this.config.fetchRelayStatus(peerId, relay.multiaddrs);
      const utilization = status.maxReservations > 0 
        ? status.activeReservations / status.maxReservations 
        : 1.0;

      relay.utilization = utilization;
      relay.lastUpdated = now;

      // Clear from failed set if utilization is below threshold
      if (utilization < this.config.maxUtilizationThreshold) {
        this.failedRelays.delete(peerId);
      }

      this.emit({ type: 'relay-status-updated', peerId, utilization });
    } catch (error) {
      // Failed to fetch status - keep existing data
      console.warn(`Failed to fetch relay status for ${peerId}:`, error);
    }
  }

  /**
   * Update status for all known relays
   */
  async updateAllRelayStatuses(): Promise<void> {
    const updates = Array.from(this.relayNodes.keys()).map(
      peerId => this.updateRelayStatus(peerId)
    );
    await Promise.all(updates);
  }

  /**
   * Clear the failed relays set (e.g., after some time has passed)
   */
  clearFailedRelays(): void {
    this.failedRelays.clear();
    if (this.inDegradedMode && this.relayNodes.size > 0) {
      this.inDegradedMode = false;
      this.emit({ type: 'degraded-mode', directPeersOnly: false });
    }
  }

  /**
   * Register an event handler
   */
  onEvent(handler: RelaySelectorEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index !== -1) {
        this.eventHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Emit an event to all handlers
   */
  private emit(event: RelaySelectorEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in relay selector event handler:', error);
      }
    }
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.relayNodes.clear();
    this.failedRelays.clear();
    this.inDegradedMode = false;
  }
}
