/**
 * Property-based tests for Connection Upgrader
 * 
 * Feature: browser-libp2p-nodes
 * 
 * Tests:
 * - Property 15: Connection Upgrade Attempts
 * 
 * **Validates: Requirements 10.6**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
  ConnectionUpgrader,
  type ConnectionUpgraderConfig,
  type RelayedConnectionInfo,
  type UpgradeAttemptResult,
  type ConnectionUpgraderEvent,
} from './connection-upgrader.js';

/**
 * Create a mock connection for testing
 */
function createMockConnection(peerId: string, isRelayed: boolean = true) {
  return {
    id: `conn-${peerId}`,
    remotePeer: { toString: () => peerId },
    remoteAddr: {
      toString: () =>
        isRelayed
          ? `/ip4/127.0.0.1/tcp/4001/p2p-circuit/p2p/${peerId}`
          : `/ip4/127.0.0.1/tcp/4001/webrtc/p2p/${peerId}`,
    },
    close: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Create a mock multiaddr
 */
function createMockMultiaddr(peerId: string, transport: 'webrtc' | 'websocket' | 'relay') {
  switch (transport) {
    case 'webrtc':
      return `/ip4/127.0.0.1/tcp/4001/webrtc/p2p/${peerId}`;
    case 'websocket':
      return `/ip4/127.0.0.1/tcp/4001/ws/p2p/${peerId}`;
    case 'relay':
      return `/ip4/127.0.0.1/tcp/4001/p2p-circuit/p2p/${peerId}`;
  }
}

/**
 * Feature: browser-libp2p-nodes, Property 15: Connection Upgrade Attempts
 * 
 * For any browser node with an active relayed connection, the node SHALL
 * periodically attempt to upgrade to a direct connection.
 * 
 * **Validates: Requirements 10.6**
 */
describe('Property 15: Connection Upgrade Attempts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * Test: Relayed connections are tracked for upgrade
   * 
   * For any relayed connection, it SHALL be tracked by the connection upgrader.
   */
  it('relayed connections are tracked for upgrade', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 20 }),
        async (peerIds) => {
          const upgrader = new ConnectionUpgrader();

          // Track each peer
          for (const peerId of peerIds) {
            upgrader.trackRelayedConnection(peerId, `conn-${peerId}`, []);
          }

          // Verify all peers are tracked
          const uniquePeerIds = [...new Set(peerIds)];
          expect(upgrader.getTrackedConnectionCount()).toBe(uniquePeerIds.length);

          for (const peerId of uniquePeerIds) {
            expect(upgrader.isTracked(peerId)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: Upgrade attempts increment counter
   * 
   * For any tracked connection, each upgrade attempt SHALL increment the attempt counter.
   */
  it('upgrade attempts increment counter', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 1, max: 5 }),
        async (peerId, attemptCount) => {
          const upgrader = new ConnectionUpgrader({
            maxUpgradeAttempts: 10,
          });

          // Track the connection
          upgrader.trackRelayedConnection(peerId, `conn-${peerId}`, []);

          // Initialize with mock functions that always fail
          upgrader.initialize(
            vi.fn().mockRejectedValue(new Error('Connection failed')),
            { get: vi.fn().mockResolvedValue(undefined) },
            vi.fn().mockReturnValue([])
          );

          // Attempt upgrades
          for (let i = 0; i < attemptCount; i++) {
            await upgrader.attemptUpgrade(peerId);
          }

          // Verify attempt count
          expect(upgrader.getUpgradeAttemptCount(peerId)).toBe(attemptCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: Max upgrade attempts is enforced
   * 
   * For any connection with maxUpgradeAttempts=N, after N failed attempts,
   * no more upgrade attempts SHALL be made.
   */
  it('max upgrade attempts is enforced', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 1, max: 10 }),
        async (peerId, maxAttempts) => {
          const upgrader = new ConnectionUpgrader({
            maxUpgradeAttempts: maxAttempts,
          });

          // Track the connection
          upgrader.trackRelayedConnection(peerId, `conn-${peerId}`, []);

          // Initialize with mock functions that always fail
          upgrader.initialize(
            vi.fn().mockRejectedValue(new Error('Connection failed')),
            { get: vi.fn().mockResolvedValue(undefined) },
            vi.fn().mockReturnValue([])
          );

          // Attempt more upgrades than allowed
          const results: UpgradeAttemptResult[] = [];
          for (let i = 0; i < maxAttempts + 5; i++) {
            const result = await upgrader.attemptUpgrade(peerId);
            results.push(result);
          }

          // Verify max attempts is enforced
          expect(upgrader.getUpgradeAttemptCount(peerId)).toBe(maxAttempts);

          // After max attempts, further attempts should fail with specific error
          const lastResult = results[results.length - 1];
          expect(lastResult.success).toBe(false);
          expect(lastResult.error).toBe('Max upgrade attempts reached');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: Successful upgrade removes connection from tracking
   * 
   * For any connection that successfully upgrades, it SHALL be removed from tracking.
   */
  it('successful upgrade removes connection from tracking', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (peerId) => {
          const upgrader = new ConnectionUpgrader();

          // Track the connection with a direct address
          const directAddr = createMockMultiaddr(peerId, 'webrtc');
          upgrader.trackRelayedConnection(peerId, `conn-${peerId}`, [directAddr]);

          // Create mock connection for the new direct connection
          const mockNewConn = createMockConnection(peerId, false);

          // Initialize with mock functions that succeed
          upgrader.initialize(
            vi.fn().mockResolvedValue(mockNewConn),
            { get: vi.fn().mockResolvedValue(undefined) },
            vi.fn().mockReturnValue([])
          );

          // Verify connection is tracked before upgrade
          expect(upgrader.isTracked(peerId)).toBe(true);

          // Attempt upgrade
          const result = await upgrader.attemptUpgrade(peerId);

          // Verify upgrade succeeded
          expect(result.success).toBe(true);
          expect(result.newTransport).toBe('webrtc');

          // Verify connection is no longer tracked
          expect(upgrader.isTracked(peerId)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: Periodic upgrade timer triggers attempts
   * 
   * For any running upgrader with tracked connections, the timer SHALL
   * trigger upgrade attempts at the configured interval.
   */
  it('periodic upgrade timer triggers attempts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 100, max: 1000 }),
        async (connectionCount, upgradeInterval) => {
          const upgrader = new ConnectionUpgrader({
            upgradeInterval,
            maxUpgradeAttempts: 10,
          });

          // Track connections
          const peerIds: string[] = [];
          for (let i = 0; i < connectionCount; i++) {
            const peerId = `peer-${i}`;
            peerIds.push(peerId);
            upgrader.trackRelayedConnection(peerId, `conn-${peerId}`, []);
          }

          // Initialize with mock functions that always fail
          const dialMock = vi.fn().mockRejectedValue(new Error('Connection failed'));
          upgrader.initialize(
            dialMock,
            { get: vi.fn().mockResolvedValue(undefined) },
            vi.fn().mockReturnValue([])
          );

          // Start the upgrader
          upgrader.start();

          // Advance time past the upgrade interval
          await vi.advanceTimersByTimeAsync(upgradeInterval + 10);

          // Verify upgrade attempts were made
          for (const peerId of peerIds) {
            expect(upgrader.getUpgradeAttemptCount(peerId)).toBeGreaterThanOrEqual(1);
          }

          // Stop the upgrader
          upgrader.stop();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: Upgrade events are emitted correctly
   * 
   * For any upgrade attempt, the appropriate events SHALL be emitted.
   */
  it('upgrade events are emitted correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (peerId) => {
          const upgrader = new ConnectionUpgrader();
          const events: ConnectionUpgraderEvent[] = [];

          // Register event handler
          upgrader.onEvent((event) => {
            events.push(event);
          });

          // Track the connection
          upgrader.trackRelayedConnection(peerId, `conn-${peerId}`, []);

          // Initialize with mock functions that fail
          upgrader.initialize(
            vi.fn().mockRejectedValue(new Error('Connection failed')),
            { get: vi.fn().mockResolvedValue(undefined) },
            vi.fn().mockReturnValue([])
          );

          // Attempt upgrade
          await upgrader.attemptUpgrade(peerId);

          // Verify events were emitted
          const trackedEvent = events.find((e) => e.type === 'connection-tracked');
          expect(trackedEvent).toBeDefined();
          expect((trackedEvent as any).peerId).toBe(peerId);

          const startedEvent = events.find((e) => e.type === 'upgrade-started');
          expect(startedEvent).toBeDefined();
          expect((startedEvent as any).peerId).toBe(peerId);

          const failedEvent = events.find((e) => e.type === 'upgrade-failed');
          expect(failedEvent).toBeDefined();
          expect((failedEvent as any).peerId).toBe(peerId);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: Untracking removes connection from upgrade list
   * 
   * For any tracked connection, untracking it SHALL remove it from the upgrade list.
   */
  it('untracking removes connection from upgrade list', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.uuid(), { minLength: 2, maxLength: 10 }),
        fc.integer({ min: 0, max: 9 }),
        async (peerIds, removeIndex) => {
          const uniquePeerIds = [...new Set(peerIds)];
          if (uniquePeerIds.length < 2) return; // Need at least 2 unique peers

          const upgrader = new ConnectionUpgrader();

          // Track all connections
          for (const peerId of uniquePeerIds) {
            upgrader.trackRelayedConnection(peerId, `conn-${peerId}`, []);
          }

          // Remove one connection
          const indexToRemove = removeIndex % uniquePeerIds.length;
          const peerIdToRemove = uniquePeerIds[indexToRemove];
          upgrader.untrackConnection(peerIdToRemove);

          // Verify it's no longer tracked
          expect(upgrader.isTracked(peerIdToRemove)).toBe(false);
          expect(upgrader.getTrackedConnectionCount()).toBe(uniquePeerIds.length - 1);

          // Verify other connections are still tracked
          for (let i = 0; i < uniquePeerIds.length; i++) {
            if (i !== indexToRemove) {
              expect(upgrader.isTracked(uniquePeerIds[i])).toBe(true);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: Upgrader can be started and stopped
   * 
   * For any upgrader, start() and stop() SHALL control the periodic timer.
   */
  it('upgrader can be started and stopped', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        async (toggleCount) => {
          const upgrader = new ConnectionUpgrader({
            upgradeInterval: 100,
          });

          // Toggle start/stop multiple times
          for (let i = 0; i < toggleCount; i++) {
            upgrader.start();
            expect(upgrader.isRunning()).toBe(true);

            upgrader.stop();
            expect(upgrader.isRunning()).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: Clear removes all tracked connections
   * 
   * For any upgrader with tracked connections, clear() SHALL remove all of them.
   */
  it('clear removes all tracked connections', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.uuid(), { minLength: 1, max: 20 }),
        async (peerIds) => {
          const upgrader = new ConnectionUpgrader();

          // Track connections
          for (const peerId of peerIds) {
            upgrader.trackRelayedConnection(peerId, `conn-${peerId}`, []);
          }

          // Verify connections are tracked
          expect(upgrader.getTrackedConnectionCount()).toBeGreaterThan(0);

          // Clear all
          upgrader.clear();

          // Verify all are removed
          expect(upgrader.getTrackedConnectionCount()).toBe(0);
          for (const peerId of peerIds) {
            expect(upgrader.isTracked(peerId)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: Upgrade in progress prevents concurrent attempts
   * 
   * For any connection with an upgrade in progress, concurrent upgrade attempts
   * SHALL be rejected.
   */
  it('upgrade in progress prevents concurrent attempts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (peerId) => {
          const upgrader = new ConnectionUpgrader();

          // Track the connection
          upgrader.trackRelayedConnection(peerId, `conn-${peerId}`, [
            createMockMultiaddr(peerId, 'webrtc'),
          ]);

          // Create a slow dial function that takes time
          let dialResolve: () => void;
          const dialPromise = new Promise<void>((resolve) => {
            dialResolve = resolve;
          });
          const dialMock = vi.fn().mockImplementation(() => dialPromise);

          upgrader.initialize(
            dialMock,
            { get: vi.fn().mockResolvedValue(undefined) },
            vi.fn().mockReturnValue([])
          );

          // Start first upgrade (don't await)
          const firstUpgrade = upgrader.attemptUpgrade(peerId);

          // Try second upgrade while first is in progress
          const secondResult = await upgrader.attemptUpgrade(peerId);

          // Second should fail because first is in progress
          expect(secondResult.success).toBe(false);
          expect(secondResult.error).toBe('Upgrade already in progress');

          // Resolve the first upgrade
          dialResolve!();
          await firstUpgrade;
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: Direct multiaddrs are filtered correctly
   * 
   * For any set of multiaddrs, only direct (non-relay) addresses SHALL be used for upgrade.
   */
  it('only direct multiaddrs are used for upgrade attempts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (peerId) => {
          const upgrader = new ConnectionUpgrader();

          // Track with mixed addresses (direct and relay)
          const directAddr = createMockMultiaddr(peerId, 'webrtc');
          const relayAddr = createMockMultiaddr(peerId, 'relay');
          const wsAddr = createMockMultiaddr(peerId, 'websocket');

          upgrader.trackRelayedConnection(peerId, `conn-${peerId}`, [
            directAddr,
            relayAddr,
            wsAddr,
          ]);

          // Track which addresses were dialed
          const dialedAddrs: string[] = [];
          const dialMock = vi.fn().mockImplementation((addr: string) => {
            dialedAddrs.push(addr);
            return Promise.reject(new Error('Connection failed'));
          });

          upgrader.initialize(
            dialMock,
            { get: vi.fn().mockResolvedValue(undefined) },
            vi.fn().mockReturnValue([])
          );

          // Attempt upgrade
          await upgrader.attemptUpgrade(peerId);

          // Verify only direct addresses were dialed (not relay)
          for (const addr of dialedAddrs) {
            expect(addr).not.toContain('/p2p-circuit/');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
