/**
 * Property-based tests for Activity Monitor
 * 
 * Feature: browser-libp2p-nodes
 * Property 3: Activity State Transitions
 * 
 * Tests:
 * - When tab becomes inactive → node SHALL transition to disconnected state
 * - When tab becomes active again → node SHALL automatically reconnect
 * 
 * **Validates: Requirements 8.4, 8.5**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { ActivityMonitor } from './activity-monitor.js';
import type { ActivityMonitorConfig } from './types.js';

/**
 * Arbitrary for generating valid activity monitor configs with reasonable grace periods
 */
const activityMonitorConfigArbitrary: fc.Arbitrary<Partial<ActivityMonitorConfig>> = fc.record({
  disconnectOnInactive: fc.boolean(),
  reconnectOnActive: fc.boolean(),
  inactivityGracePeriod: fc.integer({ min: 10, max: 100 }),
});

/**
 * Feature: browser-libp2p-nodes, Property 3: Activity State Transitions
 * 
 * For any browser node in connected state:
 * - When tab becomes inactive → node SHALL transition to disconnected state with all peers disconnected
 * - When tab becomes active again → node SHALL automatically reconnect and return to connected state
 * 
 * **Validates: Requirements 8.4, 8.5**
 */
describe('Property 3: Activity State Transitions', () => {
  let mockDocument: { hidden: boolean; addEventListener: any; removeEventListener: any };
  let mockWindow: { addEventListener: any; removeEventListener: any };
  let visibilityChangeHandler: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    
    // Mock document for visibility API
    mockDocument = {
      hidden: false,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === 'visibilitychange') {
          visibilityChangeHandler = handler;
        }
      }),
      removeEventListener: vi.fn(),
    };
    
    // Mock window for network events
    mockWindow = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    
    // Set up global mocks
    vi.stubGlobal('document', mockDocument);
    vi.stubGlobal('window', mockWindow);
    vi.stubGlobal('navigator', { onLine: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    visibilityChangeHandler = null;
  });

  /**
   * Simulate visibility change
   */
  function simulateVisibilityChange(hidden: boolean): void {
    mockDocument.hidden = hidden;
    if (visibilityChangeHandler) {
      visibilityChangeHandler();
    }
  }

  /**
   * Test: inactive → disconnect flow
   * 
   * For any config with disconnectOnInactive=true, when tab becomes inactive
   * and grace period elapses, the inactive callback SHALL be triggered.
   */
  it('inactive callback triggered after grace period when tab becomes hidden', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10, max: 100 }),
        async (gracePeriod) => {
          // Clear any pending timers from previous runs
          vi.clearAllTimers();
          
          // Reset handler for each property run
          visibilityChangeHandler = null;
          mockDocument.hidden = false;
          
          // Re-setup mock to capture new handler
          mockDocument.addEventListener = vi.fn((event: string, handler: () => void) => {
            if (event === 'visibilitychange') {
              visibilityChangeHandler = handler;
            }
          });
          
          const config: Partial<ActivityMonitorConfig> = {
            disconnectOnInactive: true,
            reconnectOnActive: true,
            inactivityGracePeriod: gracePeriod,
          };
          
          const monitor = new ActivityMonitor(config);
          let inactiveCallCount = 0;
          
          monitor.onInactive(() => {
            inactiveCallCount++;
          });
          
          monitor.start();
          
          // Tab becomes hidden
          simulateVisibilityChange(true);
          
          // Before grace period, callback should not be called
          expect(inactiveCallCount).toBe(0);
          
          // Advance time past grace period
          vi.advanceTimersByTime(gracePeriod + 10);
          
          expect(inactiveCallCount).toBe(1);
          
          monitor.stop();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: active → reconnect flow
   * 
   * For any config with reconnectOnActive=true, when tab becomes active
   * after being inactive, the active callback SHALL be triggered.
   */
  it('active callback triggered when tab becomes visible after being hidden', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10, max: 100 }),
        async (gracePeriod) => {
          const config: Partial<ActivityMonitorConfig> = {
            disconnectOnInactive: true,
            reconnectOnActive: true,
            inactivityGracePeriod: gracePeriod,
          };
          
          const monitor = new ActivityMonitor(config);
          let activeCallCount = 0;
          
          monitor.onActive(() => {
            activeCallCount++;
          });
          
          monitor.start();
          
          // Tab becomes hidden
          simulateVisibilityChange(true);
          
          // Wait for grace period
          vi.advanceTimersByTime(gracePeriod + 10);
          
          // Tab becomes visible again
          simulateVisibilityChange(false);
          
          expect(activeCallCount).toBe(1);
          
          monitor.stop();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: grace period cancellation
   * 
   * For any config, if tab becomes active before grace period elapses,
   * the inactive callback SHALL NOT be triggered.
   */
  it('inactive callback NOT triggered if tab becomes active before grace period', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 50, max: 100 }),
        fc.integer({ min: 5, max: 40 }),
        async (gracePeriod, returnTime) => {
          const config: Partial<ActivityMonitorConfig> = {
            disconnectOnInactive: true,
            reconnectOnActive: true,
            inactivityGracePeriod: gracePeriod,
          };
          
          const monitor = new ActivityMonitor(config);
          let inactiveCallCount = 0;
          let activeCallCount = 0;
          
          monitor.onInactive(() => {
            inactiveCallCount++;
          });
          
          monitor.onActive(() => {
            activeCallCount++;
          });
          
          monitor.start();
          
          // Tab becomes hidden
          simulateVisibilityChange(true);
          
          // User returns before grace period
          vi.advanceTimersByTime(returnTime);
          simulateVisibilityChange(false);
          
          // Wait past original grace period
          vi.advanceTimersByTime(gracePeriod);
          
          // Inactive should NOT have been called (grace period cancelled)
          expect(inactiveCallCount).toBe(0);
          // Active should have been called
          expect(activeCallCount).toBe(1);
          
          monitor.stop();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: full inactive → disconnect → active → reconnect cycle
   * 
   * For any valid config, the complete state transition cycle should work:
   * active → inactive (disconnect) → active (reconnect)
   */
  it('complete state transition cycle: active → inactive → active', async () => {
    await fc.assert(
      fc.asyncProperty(
        activityMonitorConfigArbitrary,
        async (config) => {
          // Force the behaviors we want to test
          const testConfig = {
            ...config,
            disconnectOnInactive: true,
            reconnectOnActive: true,
          };
          
          const monitor = new ActivityMonitor(testConfig);
          const transitions: string[] = [];
          
          monitor.onInactive(() => {
            transitions.push('inactive');
          });
          
          monitor.onActive(() => {
            transitions.push('active');
          });
          
          monitor.start();
          
          // Start active (default state)
          expect(monitor.isActive()).toBe(true);
          
          // Transition to inactive
          simulateVisibilityChange(true);
          vi.advanceTimersByTime((testConfig.inactivityGracePeriod ?? 10) + 10);
          
          // Transition back to active
          simulateVisibilityChange(false);
          
          // Verify the transition sequence
          expect(transitions).toEqual(['inactive', 'active']);
          
          monitor.stop();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: callbacks respect config flags
   * 
   * For any config, callbacks should only be triggered when their
   * corresponding config flag is true.
   */
  it('callbacks respect disconnectOnInactive and reconnectOnActive flags', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: 10, max: 50 }),
        async (disconnectOnInactive, reconnectOnActive, gracePeriod) => {
          const config: Partial<ActivityMonitorConfig> = {
            disconnectOnInactive,
            reconnectOnActive,
            inactivityGracePeriod: gracePeriod,
          };
          
          const monitor = new ActivityMonitor(config);
          let inactiveCallCount = 0;
          let activeCallCount = 0;
          
          monitor.onInactive(() => {
            inactiveCallCount++;
          });
          
          monitor.onActive(() => {
            activeCallCount++;
          });
          
          monitor.start();
          
          // Tab becomes hidden
          simulateVisibilityChange(true);
          vi.advanceTimersByTime(gracePeriod + 10);
          
          // Tab becomes visible
          simulateVisibilityChange(false);
          
          // Verify callbacks respect config
          if (disconnectOnInactive) {
            expect(inactiveCallCount).toBe(1);
          } else {
            expect(inactiveCallCount).toBe(0);
          }
          
          if (reconnectOnActive) {
            expect(activeCallCount).toBe(1);
          } else {
            expect(activeCallCount).toBe(0);
          }
          
          monitor.stop();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: multiple consecutive inactive/active cycles
   * 
   * For any number of cycles, each cycle should trigger the appropriate callbacks.
   */
  it('handles multiple inactive/active cycles correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 10, max: 50 }),
        async (cycleCount, gracePeriod) => {
          const config: Partial<ActivityMonitorConfig> = {
            disconnectOnInactive: true,
            reconnectOnActive: true,
            inactivityGracePeriod: gracePeriod,
          };
          
          const monitor = new ActivityMonitor(config);
          let inactiveCount = 0;
          let activeCount = 0;
          
          monitor.onInactive(() => {
            inactiveCount++;
          });
          
          monitor.onActive(() => {
            activeCount++;
          });
          
          monitor.start();
          
          for (let i = 0; i < cycleCount; i++) {
            // Go inactive
            simulateVisibilityChange(true);
            vi.advanceTimersByTime(gracePeriod + 10);
            
            // Go active
            simulateVisibilityChange(false);
          }
          
          // Each cycle should trigger one inactive and one active callback
          expect(inactiveCount).toBe(cycleCount);
          expect(activeCount).toBe(cycleCount);
          
          monitor.stop();
        }
      ),
      { numRuns: 100 }
    );
  });
});
