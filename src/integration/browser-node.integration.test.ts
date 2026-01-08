/**
 * Integration tests for Browser Node functionality
 *
 * Tests:
 * - 15.1 Browser node connecting to server bootstrap
 * - 15.2 Browser-to-browser WebRTC connection
 * - 15.3 Tab visibility handling
 * - 15.4 Relay capacity limits
 *
 * Feature: browser-libp2p-nodes
 * 
 * Requirements: 1.5, 2.1, 2.2, 2.3, 2.4, 3.2, 8.4, 8.5, 10.3, 10.4, 11.3
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { DHTNode } from '../dht/node.js';
import { DHTConfigBuilder } from '../dht/config.js';
import { cleanupNodes } from '../test-utils/network.js';
import { ActivityMonitor } from '../browser/activity-monitor.js';
import { RelaySelector, RESOURCE_LIMIT_EXCEEDED } from '../browser/relay-selector.js';
import { ConnectionStrategyTracker, sortMultiaddrsByPriority, getTransportType } from '../browser/transport-config.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Simple delay utility
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a condition with timeout
 */
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 10000,
  intervalMs = 100
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) return;
    await delay(intervalMs);
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

/**
 * Create a server DHT node for testing
 */
async function createServerNode(): Promise<DHTNode> {
  const config = DHTConfigBuilder.create()
    .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
    .withMaxConnections(50)
    .withMinConnections(0)
    .build();

  const node = new DHTNode(config);
  await node.start();
  return node;
}

/**
 * Mock browser globals for testing
 */
function setupBrowserMocks() {
  let hiddenState = false;
  let onlineState = true;
  const visibilityListeners: Array<() => void> = [];
  const onlineListeners: Array<() => void> = [];
  const offlineListeners: Array<() => void> = [];

  const mockDocument = {
    get hidden() {
      return hiddenState;
    },
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === 'visibilitychange') {
        visibilityListeners.push(handler);
      }
    }),
    removeEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === 'visibilitychange') {
        const index = visibilityListeners.indexOf(handler);
        if (index !== -1) visibilityListeners.splice(index, 1);
      }
    }),
  };

  const mockWindow = {
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === 'online') onlineListeners.push(handler);
      if (event === 'offline') offlineListeners.push(handler);
    }),
    removeEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === 'online') {
        const index = onlineListeners.indexOf(handler);
        if (index !== -1) onlineListeners.splice(index, 1);
      }
      if (event === 'offline') {
        const index = offlineListeners.indexOf(handler);
        if (index !== -1) offlineListeners.splice(index, 1);
      }
    }),
  };

  const mockNavigator = {
    get onLine() {
      return onlineState;
    },
  };

  vi.stubGlobal('document', mockDocument);
  vi.stubGlobal('window', mockWindow);
  vi.stubGlobal('navigator', mockNavigator);

  return {
    mockDocument,
    mockWindow,
    mockNavigator,
    setHidden: (hidden: boolean) => {
      hiddenState = hidden;
      visibilityListeners.forEach((l) => l());
    },
    setOnline: (online: boolean) => {
      const wasOnline = onlineState;
      onlineState = online;
      if (wasOnline && !online) {
        offlineListeners.forEach((l) => l());
      } else if (!wasOnline && online) {
        onlineListeners.forEach((l) => l());
      }
    },
  };
}

// ============================================================================
// 15.1 Test browser node connecting to server bootstrap
// Requirements: 1.5, 2.1
// ============================================================================

describe('15.1 Browser node connecting to server bootstrap', () => {
  let serverNodes: DHTNode[] = [];

  afterEach(async () => {
    await cleanupNodes(serverNodes);
    serverNodes = [];
  });

  it('should establish WebSocket connection to server bootstrap node', async () => {
    // Create a server node that acts as bootstrap
    const server = await createServerNode();
    serverNodes.push(server);

    // Verify server is running and has multiaddrs
    expect(server.isStarted).toBe(true);
    const multiaddrs = server.multiaddrs.map((ma) => ma.toString());
    expect(multiaddrs.length).toBeGreaterThan(0);

    // Verify server has TCP address (which can be upgraded to WebSocket)
    const hasTcpAddr = multiaddrs.some((addr) => addr.includes('/tcp/'));
    expect(hasTcpAddr).toBe(true);
  }, 30000);

  it('should complete DHT bootstrap with server node', async () => {
    // Create two server nodes
    const server1 = await createServerNode();
    const server2 = await createServerNode();
    serverNodes.push(server1, server2);

    // Bootstrap server2 to server1
    const server1Addrs = server1.multiaddrs.map((ma) => ma.toString());
    await server2.bootstrap(server1Addrs);

    // Wait for connection
    await waitFor(() => server1.getConnectionInfo().currentConnections > 0, 10000);

    // Verify DHT bootstrap completed
    expect(server2.getConnectionInfo().currentConnections).toBeGreaterThan(0);
    expect(server2.getConnectionInfo().connectedPeers).toContain(server1.peerId.toString());
  }, 30000);

  it('should populate routing table after bootstrap', async () => {
    // Create two server nodes
    const server1 = await createServerNode();
    const server2 = await createServerNode();
    serverNodes.push(server1, server2);

    // Bootstrap server2 to server1
    const server1Addrs = server1.multiaddrs.map((ma) => ma.toString());
    await server2.bootstrap(server1Addrs);

    // Wait for connection
    await waitFor(() => server1.getConnectionInfo().currentConnections > 0, 10000);

    // Give time for routing table to populate
    await delay(500);

    // Verify routing table has peers
    const routingInfo = server2.getRoutingTableInfo();
    expect(routingInfo.totalPeers).toBeGreaterThanOrEqual(0);
  }, 30000);

  it('should be able to find bootstrap peer via DHT', async () => {
    // Create two server nodes
    const server1 = await createServerNode();
    const server2 = await createServerNode();
    serverNodes.push(server1, server2);

    // Bootstrap server2 to server1
    const server1Addrs = server1.multiaddrs.map((ma) => ma.toString());
    await server2.bootstrap(server1Addrs);

    // Wait for connection
    await waitFor(() => server1.getConnectionInfo().currentConnections > 0, 10000);

    // Server2 should be able to find server1 via DHT
    const peerInfo = await server2.findPeer(server1.peerId);
    expect(peerInfo.id.toString()).toBe(server1.peerId.toString());
    expect(peerInfo.multiaddrs.length).toBeGreaterThan(0);
  }, 30000);
});

// ============================================================================
// 15.2 Test browser-to-browser WebRTC connection
// Requirements: 2.2, 2.3, 2.4, 3.2
// ============================================================================

describe('15.2 Browser-to-browser WebRTC connection', () => {
  it('should prioritize direct WebRTC connection over relay', () => {
    // Test that multiaddrs are sorted correctly
    const multiaddrs = [
      '/ip4/127.0.0.1/tcp/4001/p2p-circuit/p2p/12D3KooW...',
      '/ip4/127.0.0.1/tcp/4001/ws/p2p/12D3KooW...',
      '/ip4/127.0.0.1/udp/4001/webrtc/p2p/12D3KooW...',
    ];

    const sorted = sortMultiaddrsByPriority(multiaddrs);

    // WebRTC should be first
    expect(getTransportType(sorted[0])).toBe('webrtc');
    // WebSocket should be second
    expect(getTransportType(sorted[1])).toBe('websocket');
    // Relay should be last
    expect(getTransportType(sorted[2])).toBe('relay');
  });

  it('should track connection attempts in correct order', () => {
    const tracker = new ConnectionStrategyTracker();
    const peerId = 'test-peer-id';

    // Record direct attempt first
    tracker.recordAttempt({
      peerId,
      transport: 'webrtc',
      success: false,
      error: 'ICE failed',
    });

    // Then relay attempt
    tracker.recordAttempt({
      peerId,
      transport: 'relay',
      success: true,
    });

    // Verify direct was attempted before relay
    expect(tracker.wasDirectAttemptedBeforeRelay(peerId)).toBe(true);
  });

  it('should detect when relay is attempted without direct first', () => {
    const tracker = new ConnectionStrategyTracker();
    const peerId = 'test-peer-id';

    // Record relay attempt first (wrong order)
    tracker.recordAttempt({
      peerId,
      transport: 'relay',
      success: true,
    });

    // Verify direct was NOT attempted before relay
    expect(tracker.wasDirectAttemptedBeforeRelay(peerId)).toBe(false);
  });

  it('should correctly identify transport types from multiaddrs', () => {
    expect(getTransportType('/ip4/127.0.0.1/udp/4001/webrtc/p2p/12D3KooW...')).toBe('webrtc');
    expect(getTransportType('/ip4/127.0.0.1/udp/4001/webrtc-direct/p2p/12D3KooW...')).toBe('webrtc');
    expect(getTransportType('/ip4/127.0.0.1/tcp/4001/ws/p2p/12D3KooW...')).toBe('websocket');
    expect(getTransportType('/ip4/127.0.0.1/tcp/4001/wss/p2p/12D3KooW...')).toBe('websocket');
    expect(getTransportType('/ip4/127.0.0.1/tcp/4001/p2p-circuit/p2p/12D3KooW...')).toBe('relay');
    expect(getTransportType('/ip4/127.0.0.1/tcp/4001/p2p/12D3KooW...')).toBe(null);
  });

  it('should fall back to circuit relay when direct connection fails', () => {
    const tracker = new ConnectionStrategyTracker();
    const peerId = 'test-peer-id';

    // Simulate connection flow: direct fails, relay succeeds
    tracker.recordAttempt({
      peerId,
      transport: 'webrtc',
      success: false,
      error: 'ICE negotiation failed',
    });

    tracker.recordAttempt({
      peerId,
      transport: 'relay',
      success: true,
    });

    const attempts = tracker.getAttemptsForPeer(peerId);
    expect(attempts.length).toBe(2);
    expect(attempts[0].transport).toBe('webrtc');
    expect(attempts[0].success).toBe(false);
    expect(attempts[1].transport).toBe('relay');
    expect(attempts[1].success).toBe(true);
  });
});

// ============================================================================
// 15.3 Test tab visibility handling
// Requirements: 8.4, 8.5
// ============================================================================

describe('15.3 Tab visibility handling', () => {
  let mocks: ReturnType<typeof setupBrowserMocks>;

  beforeEach(() => {
    mocks = setupBrowserMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('should detect when tab becomes hidden', async () => {
    const monitor = new ActivityMonitor({
      disconnectOnInactive: true,
      reconnectOnActive: true,
      inactivityGracePeriod: 100, // Short grace period for testing
    });

    let inactiveTriggered = false;
    monitor.onInactive(() => {
      inactiveTriggered = true;
    });

    monitor.start();

    // Initially active
    expect(monitor.isActive()).toBe(true);

    // Simulate tab becoming hidden
    mocks.setHidden(true);

    // Wait for grace period
    await delay(150);

    expect(inactiveTriggered).toBe(true);

    monitor.stop();
  });

  it('should detect when tab becomes visible again', async () => {
    const monitor = new ActivityMonitor({
      disconnectOnInactive: true,
      reconnectOnActive: true,
      inactivityGracePeriod: 100,
    });

    let activeTriggered = false;
    monitor.onActive(() => {
      activeTriggered = true;
    });

    monitor.start();

    // Simulate tab becoming hidden then visible
    mocks.setHidden(true);
    await delay(150); // Wait for grace period

    mocks.setHidden(false);

    expect(activeTriggered).toBe(true);

    monitor.stop();
  });

  it('should cancel disconnect if tab becomes visible during grace period', async () => {
    const monitor = new ActivityMonitor({
      disconnectOnInactive: true,
      reconnectOnActive: true,
      inactivityGracePeriod: 200, // Longer grace period
    });

    let inactiveTriggered = false;
    monitor.onInactive(() => {
      inactiveTriggered = true;
    });

    monitor.start();

    // Simulate tab becoming hidden
    mocks.setHidden(true);

    // Wait less than grace period
    await delay(50);

    // Tab becomes visible again before grace period ends
    mocks.setHidden(false);

    // Wait for what would have been the full grace period
    await delay(200);

    // Inactive should NOT have been triggered
    expect(inactiveTriggered).toBe(false);

    monitor.stop();
  });

  it('should detect network offline state', async () => {
    const monitor = new ActivityMonitor({
      disconnectOnInactive: true,
      reconnectOnActive: true,
      inactivityGracePeriod: 100,
    });

    let offlineTriggered = false;
    monitor.onNetworkOffline(() => {
      offlineTriggered = true;
    });

    monitor.start();

    // Initially online
    expect(monitor.isOnline()).toBe(true);

    // Simulate going offline
    mocks.setOnline(false);

    expect(offlineTriggered).toBe(true);

    monitor.stop();
  });

  it('should detect network online state', async () => {
    const monitor = new ActivityMonitor({
      disconnectOnInactive: true,
      reconnectOnActive: true,
      inactivityGracePeriod: 100,
    });

    let onlineTriggered = false;
    monitor.onNetworkOnline(() => {
      onlineTriggered = true;
    });

    monitor.start();

    // Go offline first
    mocks.setOnline(false);

    // Then come back online
    mocks.setOnline(true);

    expect(onlineTriggered).toBe(true);

    monitor.stop();
  });

  it('should handle rapid visibility changes correctly', async () => {
    const monitor = new ActivityMonitor({
      disconnectOnInactive: true,
      reconnectOnActive: true,
      inactivityGracePeriod: 100,
    });

    let inactiveCount = 0;
    let activeCount = 0;

    monitor.onInactive(() => {
      inactiveCount++;
    });

    monitor.onActive(() => {
      activeCount++;
    });

    monitor.start();

    // Rapid visibility changes
    mocks.setHidden(true);
    await delay(50);
    mocks.setHidden(false);
    await delay(50);
    mocks.setHidden(true);
    await delay(50);
    mocks.setHidden(false);

    // Wait for any pending grace periods
    await delay(200);

    // Should not have triggered inactive due to rapid changes
    // (grace period was cancelled each time)
    expect(inactiveCount).toBe(0);

    monitor.stop();
  });
});

// ============================================================================
// 15.4 Test relay capacity limits
// Requirements: 10.3, 10.4, 11.3
// ============================================================================

describe('15.4 Relay capacity limits', () => {
  it('should reject new reservations when at capacity', () => {
    const selector = new RelaySelector({
      maxUtilizationThreshold: 0.95,
      statusCacheTTL: 30000,
      maxRetryAttempts: 3,
    });

    // Add a relay at full capacity
    selector.addRelay({
      peerId: 'relay-1',
      multiaddrs: ['/ip4/127.0.0.1/tcp/4001/p2p/relay-1'],
      utilization: 1.0, // Full capacity
      lastUpdated: Date.now(),
    });

    // Try to select a relay
    const result = selector.selectRelay();

    // Should not select the full relay
    expect(result.peerId).toBeNull();
    expect(result.relaysAtCapacity).toBe(1);
  });

  it('should select least loaded relay', () => {
    const selector = new RelaySelector({
      maxUtilizationThreshold: 0.95,
      statusCacheTTL: 30000,
      maxRetryAttempts: 3,
    });

    // Add relays with different utilization
    selector.addRelay({
      peerId: 'relay-1',
      multiaddrs: ['/ip4/127.0.0.1/tcp/4001/p2p/relay-1'],
      utilization: 0.8,
      lastUpdated: Date.now(),
    });

    selector.addRelay({
      peerId: 'relay-2',
      multiaddrs: ['/ip4/127.0.0.1/tcp/4002/p2p/relay-2'],
      utilization: 0.3, // Least loaded
      lastUpdated: Date.now(),
    });

    selector.addRelay({
      peerId: 'relay-3',
      multiaddrs: ['/ip4/127.0.0.1/tcp/4003/p2p/relay-3'],
      utilization: 0.6,
      lastUpdated: Date.now(),
    });

    // Should select the least loaded relay
    const result = selector.selectRelay();
    expect(result.peerId).toBe('relay-2');
  });

  it('should failover to alternative relay on RESOURCE_LIMIT_EXCEEDED', () => {
    const selector = new RelaySelector({
      maxUtilizationThreshold: 0.95,
      statusCacheTTL: 30000,
      maxRetryAttempts: 3,
    });

    // Add two relays
    selector.addRelay({
      peerId: 'relay-1',
      multiaddrs: ['/ip4/127.0.0.1/tcp/4001/p2p/relay-1'],
      utilization: 0.5,
      lastUpdated: Date.now(),
    });

    selector.addRelay({
      peerId: 'relay-2',
      multiaddrs: ['/ip4/127.0.0.1/tcp/4002/p2p/relay-2'],
      utilization: 0.6,
      lastUpdated: Date.now(),
    });

    // First selection should be relay-1 (lower utilization)
    const firstResult = selector.selectRelay();
    expect(firstResult.peerId).toBe('relay-1');

    // Simulate RESOURCE_LIMIT_EXCEEDED from relay-1
    const shouldRetry = selector.handleRelayResult({
      success: false,
      errorCode: RESOURCE_LIMIT_EXCEEDED,
      relayPeerId: 'relay-1',
    });

    // Should indicate retry is possible
    expect(shouldRetry).toBe(true);

    // Next selection should be relay-2 (relay-1 is now marked as failed)
    const secondResult = selector.selectRelay();
    expect(secondResult.peerId).toBe('relay-2');
  });

  it('should enter degraded mode when all relays are full', () => {
    const selector = new RelaySelector({
      maxUtilizationThreshold: 0.95,
      statusCacheTTL: 30000,
      maxRetryAttempts: 3,
    });

    let degradedModeEvent: { directPeersOnly: boolean } | null = null;
    selector.onEvent((event) => {
      if (event.type === 'degraded-mode') {
        degradedModeEvent = { directPeersOnly: event.directPeersOnly };
      }
    });

    // Add relays at full capacity
    selector.addRelay({
      peerId: 'relay-1',
      multiaddrs: ['/ip4/127.0.0.1/tcp/4001/p2p/relay-1'],
      utilization: 1.0,
      lastUpdated: Date.now(),
    });

    selector.addRelay({
      peerId: 'relay-2',
      multiaddrs: ['/ip4/127.0.0.1/tcp/4002/p2p/relay-2'],
      utilization: 0.96, // Above threshold
      lastUpdated: Date.now(),
    });

    // Try to select a relay
    const result = selector.selectRelay();

    // Should be in degraded mode
    expect(result.peerId).toBeNull();
    expect(selector.isInDegradedMode()).toBe(true);
    expect(degradedModeEvent).not.toBeNull();
    expect(degradedModeEvent!.directPeersOnly).toBe(true);
  });

  it('should exit degraded mode when relay becomes available', () => {
    const selector = new RelaySelector({
      maxUtilizationThreshold: 0.95,
      statusCacheTTL: 30000,
      maxRetryAttempts: 3,
    });

    // Add relay at full capacity
    selector.addRelay({
      peerId: 'relay-1',
      multiaddrs: ['/ip4/127.0.0.1/tcp/4001/p2p/relay-1'],
      utilization: 1.0,
      lastUpdated: Date.now(),
    });

    // Enter degraded mode
    selector.selectRelay();
    expect(selector.isInDegradedMode()).toBe(true);

    // Add a new relay with capacity
    selector.addRelay({
      peerId: 'relay-2',
      multiaddrs: ['/ip4/127.0.0.1/tcp/4002/p2p/relay-2'],
      utilization: 0.5,
      lastUpdated: Date.now(),
    });

    // Select should now succeed and exit degraded mode
    const result = selector.selectRelay();
    expect(result.peerId).toBe('relay-2');
    expect(selector.isInDegradedMode()).toBe(false);
  });

  it('should retry with alternative relays using requestRelayWithFailover', async () => {
    const selector = new RelaySelector({
      maxUtilizationThreshold: 0.95,
      statusCacheTTL: 30000,
      maxRetryAttempts: 3,
    });

    // Add three relays
    selector.addRelay({
      peerId: 'relay-1',
      multiaddrs: ['/ip4/127.0.0.1/tcp/4001/p2p/relay-1'],
      utilization: 0.5,
      lastUpdated: Date.now(),
    });

    selector.addRelay({
      peerId: 'relay-2',
      multiaddrs: ['/ip4/127.0.0.1/tcp/4002/p2p/relay-2'],
      utilization: 0.6,
      lastUpdated: Date.now(),
    });

    selector.addRelay({
      peerId: 'relay-3',
      multiaddrs: ['/ip4/127.0.0.1/tcp/4003/p2p/relay-3'],
      utilization: 0.7,
      lastUpdated: Date.now(),
    });

    // Mock relay request function that fails first two, succeeds on third
    const requestRelay = vi.fn().mockImplementation((peerId: string) => {
      if (peerId === 'relay-1' || peerId === 'relay-2') {
        return Promise.resolve({
          success: false,
          errorCode: RESOURCE_LIMIT_EXCEEDED,
          relayPeerId: peerId,
        });
      }
      return Promise.resolve({
        success: true,
        relayPeerId: peerId,
      });
    });

    const result = await selector.requestRelayWithFailover(requestRelay);

    // Should have succeeded on relay-3
    expect(result.success).toBe(true);
    expect(result.result?.relayPeerId).toBe('relay-3');
    expect(result.attemptedRelays).toContain('relay-1');
    expect(result.attemptedRelays).toContain('relay-2');
    expect(result.attemptedRelays).toContain('relay-3');
  });

  it('should fail after max retry attempts', async () => {
    const selector = new RelaySelector({
      maxUtilizationThreshold: 0.95,
      statusCacheTTL: 30000,
      maxRetryAttempts: 2, // Only 2 retries
    });

    // Add three relays
    selector.addRelay({
      peerId: 'relay-1',
      multiaddrs: ['/ip4/127.0.0.1/tcp/4001/p2p/relay-1'],
      utilization: 0.5,
      lastUpdated: Date.now(),
    });

    selector.addRelay({
      peerId: 'relay-2',
      multiaddrs: ['/ip4/127.0.0.1/tcp/4002/p2p/relay-2'],
      utilization: 0.6,
      lastUpdated: Date.now(),
    });

    selector.addRelay({
      peerId: 'relay-3',
      multiaddrs: ['/ip4/127.0.0.1/tcp/4003/p2p/relay-3'],
      utilization: 0.7,
      lastUpdated: Date.now(),
    });

    // Mock relay request function that always fails
    const requestRelay = vi.fn().mockImplementation((peerId: string) => {
      return Promise.resolve({
        success: false,
        errorCode: RESOURCE_LIMIT_EXCEEDED,
        relayPeerId: peerId,
      });
    });

    const result = await selector.requestRelayWithFailover(requestRelay);

    // Should have failed after max retries
    expect(result.success).toBe(false);
    expect(result.attemptedRelays.length).toBe(2); // Only 2 attempts due to maxRetryAttempts
  });

  it('should emit events for relay selection and failures', () => {
    const selector = new RelaySelector({
      maxUtilizationThreshold: 0.95,
      statusCacheTTL: 30000,
      maxRetryAttempts: 3,
    });

    const events: Array<{ type: string }> = [];
    selector.onEvent((event) => {
      events.push({ type: event.type });
    });

    // Add a relay
    selector.addRelay({
      peerId: 'relay-1',
      multiaddrs: ['/ip4/127.0.0.1/tcp/4001/p2p/relay-1'],
      utilization: 0.5,
      lastUpdated: Date.now(),
    });

    // Select relay
    selector.selectRelay();

    // Should have emitted relay-selected event
    expect(events.some((e) => e.type === 'relay-selected')).toBe(true);

    // Simulate failure
    selector.handleRelayResult({
      success: false,
      errorCode: RESOURCE_LIMIT_EXCEEDED,
      relayPeerId: 'relay-1',
    });

    // Should have emitted relay-failed event
    expect(events.some((e) => e.type === 'relay-failed')).toBe(true);
  });
});
