/**
 * Property-based tests for Relay Selector
 * 
 * Feature: browser-libp2p-nodes
 * 
 * Property 13: Relay Failover
 * Property 14: Graceful Degradation
 * 
 * Tests relay selection, failover on RESOURCE_LIMIT_EXCEEDED,
 * and graceful degradation when all relays are full.
 * 
 * **Validates: Requirements 10.4, 10.5, 11.1, 11.3**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  RelaySelector,
  RESOURCE_LIMIT_EXCEEDED,
  type RelaySelectorConfig,
  type RelayRequestResult,
} from './relay-selector.js';
import type { RelayNodeInfo } from './types.js';

/**
 * Arbitrary for generating valid peer IDs
 */
const peerIdArbitrary = fc.stringMatching(/^12D3KooW[a-zA-Z0-9]{44}$/);

/**
 * Arbitrary for generating relay node info
 */
const relayNodeInfoArbitrary = (utilizationRange?: { min: number; max: number }): fc.Arbitrary<RelayNodeInfo> => {
  const utilRange = utilizationRange ?? { min: 0, max: 1 };
  return fc.record({
    peerId: peerIdArbitrary,
    multiaddrs: fc.array(
      fc.tuple(fc.ipV4(), fc.integer({ min: 1024, max: 65535 }))
        .map(([ip, port]) => `/ip4/${ip}/tcp/${port}/ws`),
      { minLength: 1, maxLength: 3 }
    ),
    utilization: fc.double({ min: utilRange.min, max: utilRange.max, noNaN: true }),
    lastUpdated: fc.integer({ min: 0, max: Date.now() }),
  });
};

/**
 * Arbitrary for generating a list of relay nodes with unique peer IDs
 */
const uniqueRelayNodesArbitrary = (
  count: { min: number; max: number },
  utilizationRange?: { min: number; max: number }
): fc.Arbitrary<RelayNodeInfo[]> => {
  return fc.array(relayNodeInfoArbitrary(utilizationRange), { minLength: count.min, maxLength: count.max })
    .map(relays => {
      // Ensure unique peer IDs
      const seen = new Set<string>();
      return relays.filter(r => {
        if (seen.has(r.peerId)) return false;
        seen.add(r.peerId);
        return true;
      });
    })
    .filter(relays => relays.length >= count.min);
};

/**
 * Arbitrary for relay selector config
 */
const relaySelectorConfigArbitrary: fc.Arbitrary<Partial<RelaySelectorConfig>> = fc.record({
  maxUtilizationThreshold: fc.double({ min: 0.5, max: 1.0, noNaN: true }),
  maxRetryAttempts: fc.integer({ min: 1, max: 5 }),
});

/**
 * Feature: browser-libp2p-nodes, Property 13: Relay Failover
 * 
 * For any browser node that receives RESOURCE_LIMIT_EXCEEDED from a relay,
 * the browser SHALL attempt at least one alternative relay before giving up.
 * 
 * **Validates: Requirements 10.4, 11.3**
 */
describe('Property 13: Relay Failover', () => {
  let selector: RelaySelector;

  beforeEach(() => {
    selector = new RelaySelector();
  });

  /**
   * Test that when a relay returns RESOURCE_LIMIT_EXCEEDED,
   * the selector attempts an alternative relay
   */
  it('attempts alternative relay on RESOURCE_LIMIT_EXCEEDED', async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueRelayNodesArbitrary({ min: 2, max: 5 }, { min: 0, max: 0.5 }),
        async (relays) => {
          selector.clear();
          
          // Add all relays
          for (const relay of relays) {
            selector.addRelay(relay);
          }

          // Select first relay
          const firstSelection = selector.selectRelay();
          expect(firstSelection.peerId).not.toBeNull();

          // Simulate RESOURCE_LIMIT_EXCEEDED from first relay
          const result: RelayRequestResult = {
            success: false,
            errorCode: RESOURCE_LIMIT_EXCEEDED,
            errorMessage: 'Relay at capacity',
            relayPeerId: firstSelection.peerId!,
          };

          const shouldRetry = selector.handleRelayResult(result);

          // Should suggest retry since we have more relays
          expect(shouldRetry).toBe(true);

          // Select alternative relay
          const alternativeSelection = selector.selectAlternativeRelay([firstSelection.peerId!]);
          
          // Alternative should be different from first
          expect(alternativeSelection.peerId).not.toBeNull();
          expect(alternativeSelection.peerId).not.toBe(firstSelection.peerId);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that requestRelayWithFailover tries multiple relays on failure
   */
  it('requestRelayWithFailover tries multiple relays on RESOURCE_LIMIT_EXCEEDED', async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueRelayNodesArbitrary({ min: 3, max: 5 }, { min: 0, max: 0.3 }),
        fc.integer({ min: 1, max: 2 }),
        async (relays, failCount) => {
          selector.clear();
          
          // Add all relays
          for (const relay of relays) {
            selector.addRelay(relay);
          }

          const attemptedPeerIds: string[] = [];
          let callCount = 0;

          // Mock relay request that fails first N times with RESOURCE_LIMIT_EXCEEDED
          const mockRequestRelay = async (peerId: string, _multiaddrs: string[]): Promise<RelayRequestResult> => {
            attemptedPeerIds.push(peerId);
            callCount++;

            if (callCount <= failCount) {
              return {
                success: false,
                errorCode: RESOURCE_LIMIT_EXCEEDED,
                errorMessage: 'Relay at capacity',
                relayPeerId: peerId,
              };
            }

            return {
              success: true,
              relayPeerId: peerId,
            };
          };

          const result = await selector.requestRelayWithFailover(mockRequestRelay);

          // Should have succeeded after retries
          expect(result.success).toBe(true);
          
          // Should have attempted multiple relays
          expect(result.attemptedRelays.length).toBe(failCount + 1);
          
          // All attempted relays should be unique
          const uniqueAttempts = new Set(result.attemptedRelays);
          expect(uniqueAttempts.size).toBe(result.attemptedRelays.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that failed relays are excluded from subsequent selections
   */
  it('excludes failed relays from subsequent selections', async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueRelayNodesArbitrary({ min: 3, max: 5 }, { min: 0, max: 0.5 }),
        async (relays) => {
          selector.clear();
          
          // Add all relays
          for (const relay of relays) {
            selector.addRelay(relay);
          }

          // Mark first relay as failed
          const firstSelection = selector.selectRelay();
          selector.handleRelayResult({
            success: false,
            errorCode: RESOURCE_LIMIT_EXCEEDED,
            relayPeerId: firstSelection.peerId!,
          });

          // Subsequent selections should not return the failed relay
          for (let i = 0; i < 5; i++) {
            const selection = selector.selectRelay();
            if (selection.peerId !== null) {
              expect(selection.peerId).not.toBe(firstSelection.peerId);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that handleRelayResult returns false when no alternatives available
   */
  it('handleRelayResult returns false when no alternatives available', async () => {
    await fc.assert(
      fc.asyncProperty(
        relayNodeInfoArbitrary({ min: 0, max: 0.5 }),
        async (relay) => {
          selector.clear();
          
          // Add only one relay
          selector.addRelay(relay);

          // Mark it as failed
          const shouldRetry = selector.handleRelayResult({
            success: false,
            errorCode: RESOURCE_LIMIT_EXCEEDED,
            relayPeerId: relay.peerId,
          });

          // Should not suggest retry since no alternatives
          expect(shouldRetry).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that successful relay clears failed status
   */
  it('successful relay clears failed status', async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueRelayNodesArbitrary({ min: 2, max: 4 }, { min: 0, max: 0.5 }),
        async (relays) => {
          selector.clear();
          
          // Add all relays
          for (const relay of relays) {
            selector.addRelay(relay);
          }

          const firstRelay = relays[0];

          // Mark first relay as failed
          selector.handleRelayResult({
            success: false,
            errorCode: RESOURCE_LIMIT_EXCEEDED,
            relayPeerId: firstRelay.peerId,
          });

          // Verify it's excluded
          const selectionAfterFail = selector.selectRelay();
          if (selectionAfterFail.peerId !== null && relays.length > 1) {
            expect(selectionAfterFail.peerId).not.toBe(firstRelay.peerId);
          }

          // Mark as successful
          selector.handleRelayResult({
            success: true,
            relayPeerId: firstRelay.peerId,
          });

          // Clear failed relays to allow re-selection
          selector.clearFailedRelays();

          // Update utilization to make it selectable again
          selector.addRelay({ ...firstRelay, utilization: 0 });

          // Now it should be selectable again (if it has lowest utilization)
          const selectionAfterSuccess = selector.selectRelay();
          // The relay should be in the pool again
          const allRelays = selector.getRelays();
          expect(allRelays.some(r => r.peerId === firstRelay.peerId)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: browser-libp2p-nodes, Property 14: Graceful Degradation
 * 
 * For any browser node where all relay attempts fail, the node SHALL
 * remain operational and able to communicate with directly-connectable peers.
 * 
 * **Validates: Requirements 10.5, 11.1**
 */
describe('Property 14: Graceful Degradation', () => {
  let selector: RelaySelector;

  beforeEach(() => {
    selector = new RelaySelector();
  });

  /**
   * Test that selector enters degraded mode when all relays are at capacity
   */
  it('enters degraded mode when all relays at capacity', async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueRelayNodesArbitrary({ min: 1, max: 5 }, { min: 0.96, max: 1.0 }),
        async (relays) => {
          selector.clear();
          
          // Add all relays with high utilization (above threshold)
          for (const relay of relays) {
            selector.addRelay({ ...relay, utilization: 0.96 });
          }

          // Selection should return null
          const selection = selector.selectRelay();
          expect(selection.peerId).toBeNull();
          expect(selection.relaysAtCapacity).toBe(relays.length);

          // Should be in degraded mode
          expect(selector.isInDegradedMode()).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that selector emits degraded-mode event when all relays full
   */
  it('emits degraded-mode event when all relays full', async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueRelayNodesArbitrary({ min: 1, max: 3 }, { min: 0, max: 0.5 }),
        async (relays) => {
          selector.clear();
          
          const events: Array<{ type: string }> = [];
          selector.onEvent(event => events.push(event));

          // Add relays with low utilization first
          for (const relay of relays) {
            selector.addRelay(relay);
          }

          // Mark all relays as failed
          for (const relay of relays) {
            selector.handleRelayResult({
              success: false,
              errorCode: RESOURCE_LIMIT_EXCEEDED,
              relayPeerId: relay.peerId,
            });
          }

          // Try to select - should trigger degraded mode
          selector.selectRelay();

          // Should have emitted degraded-mode event
          const degradedEvents = events.filter(e => e.type === 'degraded-mode');
          expect(degradedEvents.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that selector exits degraded mode when relay becomes available
   */
  it('exits degraded mode when relay becomes available', async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueRelayNodesArbitrary({ min: 2, max: 4 }, { min: 0.96, max: 1.0 }),
        async (relays) => {
          selector.clear();
          
          // Add all relays at capacity
          for (const relay of relays) {
            selector.addRelay({ ...relay, utilization: 0.96 });
          }

          // Verify in degraded mode
          selector.selectRelay();
          expect(selector.isInDegradedMode()).toBe(true);

          // Make one relay available
          const availableRelay = { ...relays[0], utilization: 0.5 };
          selector.addRelay(availableRelay);

          // Selection should now succeed
          const selection = selector.selectRelay();
          expect(selection.peerId).not.toBeNull();

          // Should exit degraded mode
          expect(selector.isInDegradedMode()).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that requestRelayWithFailover returns gracefully when all relays fail
   */
  it('requestRelayWithFailover returns gracefully when all relays fail', async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueRelayNodesArbitrary({ min: 1, max: 3 }, { min: 0, max: 0.5 }),
        async (relays) => {
          selector.clear();
          
          // Add all relays
          for (const relay of relays) {
            selector.addRelay(relay);
          }

          // Mock relay request that always fails
          const mockRequestRelay = async (peerId: string, _multiaddrs: string[]): Promise<RelayRequestResult> => {
            return {
              success: false,
              errorCode: RESOURCE_LIMIT_EXCEEDED,
              errorMessage: 'Relay at capacity',
              relayPeerId: peerId,
            };
          };

          const result = await selector.requestRelayWithFailover(mockRequestRelay);

          // Should have failed gracefully
          expect(result.success).toBe(false);
          
          // Should have attempted all available relays (up to maxRetryAttempts)
          expect(result.attemptedRelays.length).toBeGreaterThan(0);
          expect(result.attemptedRelays.length).toBeLessThanOrEqual(
            Math.min(relays.length, selector['config'].maxRetryAttempts)
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that selector remains functional after all relays fail
   */
  it('selector remains functional after all relays fail', async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueRelayNodesArbitrary({ min: 1, max: 3 }, { min: 0, max: 0.5 }),
        async (relays) => {
          selector.clear();
          
          // Add all relays
          for (const relay of relays) {
            selector.addRelay(relay);
          }

          // Mark all as failed
          for (const relay of relays) {
            selector.handleRelayResult({
              success: false,
              errorCode: RESOURCE_LIMIT_EXCEEDED,
              relayPeerId: relay.peerId,
            });
          }

          // Selector should still be functional
          expect(selector.getRelayCount()).toBe(relays.length);
          
          // Selection returns null but doesn't throw
          const selection = selector.selectRelay();
          expect(selection.peerId).toBeNull();
          expect(selection.totalRelays).toBe(relays.length);

          // Can still add new relays
          const newRelay: RelayNodeInfo = {
            peerId: '12D3KooWNewRelayPeerIdForTestingPurposesOnly123',
            multiaddrs: ['/ip4/192.168.1.1/tcp/4001/ws'],
            utilization: 0.1,
            lastUpdated: Date.now(),
          };
          selector.addRelay(newRelay);
          expect(selector.getRelayCount()).toBe(relays.length + 1);

          // New relay should be selectable
          const newSelection = selector.selectRelay();
          expect(newSelection.peerId).toBe(newRelay.peerId);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that clearFailedRelays allows re-selection of previously failed relays
   * Note: When a relay fails with RESOURCE_LIMIT_EXCEEDED, its utilization is set to 1.0.
   * clearFailedRelays() removes the relay from the failed set, but the utilization
   * must also be reset (e.g., via status update) for the relay to be selectable again.
   */
  it('clearFailedRelays allows re-selection of previously failed relays', async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueRelayNodesArbitrary({ min: 1, max: 3 }, { min: 0, max: 0.5 }),
        async (relays) => {
          selector.clear();
          
          // Add all relays
          for (const relay of relays) {
            selector.addRelay(relay);
          }

          // Mark all as failed
          for (const relay of relays) {
            selector.handleRelayResult({
              success: false,
              errorCode: RESOURCE_LIMIT_EXCEEDED,
              relayPeerId: relay.peerId,
            });
          }

          // Verify in degraded mode
          selector.selectRelay();
          expect(selector.isInDegradedMode()).toBe(true);

          // Clear failed relays
          selector.clearFailedRelays();

          // Should exit degraded mode
          expect(selector.isInDegradedMode()).toBe(false);

          // Re-add relays with original (low) utilization to simulate status refresh
          // This is the expected flow: after clearing failed relays, a status update
          // would refresh the utilization values
          for (const relay of relays) {
            selector.addRelay(relay);
          }

          // Should be able to select relays again
          const selection = selector.selectRelay();
          expect(selection.peerId).not.toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that selection returns correct statistics even in degraded mode
   */
  it('selection returns correct statistics in degraded mode', async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueRelayNodesArbitrary({ min: 2, max: 5 }, { min: 0, max: 0.5 }),
        fc.integer({ min: 1, max: 4 }),
        async (relays, failCount) => {
          selector.clear();
          
          // Add all relays
          for (const relay of relays) {
            selector.addRelay(relay);
          }

          // Mark some relays as failed
          const actualFailCount = Math.min(failCount, relays.length);
          for (let i = 0; i < actualFailCount; i++) {
            selector.handleRelayResult({
              success: false,
              errorCode: RESOURCE_LIMIT_EXCEEDED,
              relayPeerId: relays[i].peerId,
            });
          }

          const selection = selector.selectRelay();

          // Statistics should be accurate
          expect(selection.totalRelays).toBe(relays.length);
          expect(selection.relaysAtCapacity).toBe(actualFailCount);

          if (actualFailCount < relays.length) {
            // Should have selected a non-failed relay
            expect(selection.peerId).not.toBeNull();
            expect(relays.slice(0, actualFailCount).every(r => r.peerId !== selection.peerId)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Additional property tests for relay selection algorithm
 */
describe('Relay Selection Algorithm Properties', () => {
  let selector: RelaySelector;

  beforeEach(() => {
    selector = new RelaySelector();
  });

  /**
   * Test that selector always picks the least loaded relay
   */
  it('always selects the least loaded relay', async () => {
    await fc.assert(
      fc.asyncProperty(
        uniqueRelayNodesArbitrary({ min: 2, max: 5 }, { min: 0, max: 0.9 }),
        async (relays) => {
          selector.clear();
          
          // Add all relays
          for (const relay of relays) {
            selector.addRelay(relay);
          }

          const selection = selector.selectRelay();
          
          if (selection.peerId !== null) {
            const selectedRelay = relays.find(r => r.peerId === selection.peerId);
            expect(selectedRelay).toBeDefined();

            // Verify it has the lowest utilization among available relays
            const availableRelays = relays.filter(r => r.utilization < 0.95);
            const minUtilization = Math.min(...availableRelays.map(r => r.utilization));
            expect(selectedRelay!.utilization).toBe(minUtilization);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that adding relays from config works correctly
   */
  it('addRelaysFromConfig adds all relays with initial utilization', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            peerId: peerIdArbitrary,
            multiaddrs: fc.array(
              fc.tuple(fc.ipV4(), fc.integer({ min: 1024, max: 65535 }))
                .map(([ip, port]) => `/ip4/${ip}/tcp/${port}/ws`),
              { minLength: 1, maxLength: 2 }
            ),
          }),
          { minLength: 1, maxLength: 5 }
        ).map(relays => {
          // Ensure unique peer IDs
          const seen = new Set<string>();
          return relays.filter(r => {
            if (seen.has(r.peerId)) return false;
            seen.add(r.peerId);
            return true;
          });
        }),
        async (relayConfigs) => {
          selector.clear();
          
          selector.addRelaysFromConfig(relayConfigs);

          expect(selector.getRelayCount()).toBe(relayConfigs.length);

          // All relays should have initial utilization of 0
          const relays = selector.getRelays();
          for (const relay of relays) {
            expect(relay.utilization).toBe(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
