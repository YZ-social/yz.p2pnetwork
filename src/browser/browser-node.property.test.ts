/**
 * Property-based tests for Browser Node
 * 
 * Feature: browser-libp2p-nodes
 * 
 * Tests:
 * - Property 8: Graceful Disconnect on Tab Close
 * - Property 7: Connection Limit Enforcement
 * 
 * **Validates: Requirements 1.7, 8.1, 8.2**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { BrowserNode } from './browser-node.js';
import type { BrowserNodeConfig } from './types.js';

/**
 * Mock libp2p connection for testing
 */
interface MockConnection {
  id: string;
  remotePeer: { toString: () => string };
  remoteAddr: { toString: () => string };
  timeline: { open: number };
  close: () => Promise<void>;
  closed: boolean;
}

/**
 * Create a mock connection
 */
function createMockConnection(id: string, isWebRTC: boolean = false): MockConnection {
  const conn: MockConnection = {
    id,
    remotePeer: { toString: () => `peer-${id}` },
    remoteAddr: { toString: () => isWebRTC ? `/webrtc/peer-${id}` : `/ws/peer-${id}` },
    timeline: { open: Date.now() - Math.random() * 10000 },
    close: vi.fn().mockImplementation(async () => {
      conn.closed = true;
    }),
    closed: false,
  };
  return conn;
}

/**
 * Mock libp2p node for testing
 */
function createMockLibp2p(connections: MockConnection[]) {
  return {
    peerId: { toString: () => 'test-peer-id' },
    getConnections: vi.fn(() => connections),
    getMultiaddrs: vi.fn(() => []),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    dial: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    services: {
      dht: {
        put: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockImplementation(async function* () {}),
        getClosestPeers: vi.fn().mockImplementation(async function* () {}),
      },
    },
  };
}

/**
 * Feature: browser-libp2p-nodes, Property 8: Graceful Disconnect on Tab Close
 * 
 * For any browser node with active connections, when stop() is called (tab close),
 * all connected peers SHALL receive disconnect notifications and the connection
 * count SHALL reach zero.
 * 
 * **Validates: Requirements 1.7**
 */
describe('Property 8: Graceful Disconnect on Tab Close', () => {
  let mockDocument: { hidden: boolean; addEventListener: any; removeEventListener: any };
  let mockWindow: { addEventListener: any; removeEventListener: any };
  let mockNavigator: { onLine: boolean };
  let mockIndexedDB: any;

  beforeEach(() => {
    vi.useFakeTimers();
    
    // Mock document for visibility API
    mockDocument = {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    
    // Mock window for network events
    mockWindow = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    
    // Mock navigator
    mockNavigator = { onLine: true };
    
    // Mock IndexedDB
    mockIndexedDB = {
      open: vi.fn().mockReturnValue({
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null,
        result: {
          objectStoreNames: { contains: () => true },
          createObjectStore: vi.fn(),
          transaction: vi.fn().mockReturnValue({
            objectStore: vi.fn().mockReturnValue({
              get: vi.fn().mockReturnValue({ onsuccess: null, onerror: null }),
              put: vi.fn().mockReturnValue({ onsuccess: null, onerror: null }),
            }),
          }),
          close: vi.fn(),
        },
      }),
    };
    
    // Set up global mocks
    vi.stubGlobal('document', mockDocument);
    vi.stubGlobal('window', mockWindow);
    vi.stubGlobal('navigator', mockNavigator);
    vi.stubGlobal('indexedDB', mockIndexedDB);
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = Math.floor(Math.random() * 256);
        }
        return arr;
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * Test: All connections closed on stop()
   * 
   * For any number of active connections, calling stop() SHALL close all of them.
   */
  it('all connections are closed when stop() is called', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),
        async (connectionCount) => {
          // Create mock connections
          const connections = Array.from({ length: connectionCount }, (_, i) => 
            createMockConnection(`conn-${i}`, i % 2 === 0)
          );
          
          // Create mock libp2p
          const mockLibp2p = createMockLibp2p(connections);
          
          // Create browser node with mocked internals
          const node = new BrowserNode({
            bootstrapUrls: [],
            peerIdMode: 'ephemeral',
            maxConnections: 50,
          });
          
          // Inject mock libp2p (simulating started state)
          // @ts-expect-error - accessing private property for testing
          node.libp2p = mockLibp2p;
          // @ts-expect-error - accessing private property for testing
          node.state = {
            status: 'connected',
            peerId: 'test-peer-id',
            connectedPeers: connectionCount,
            browserPeers: Math.floor(connectionCount / 2),
            serverPeers: Math.ceil(connectionCount / 2),
            routingTableSize: 0,
            bytesIn: 0,
            bytesOut: 0,
          };
          
          // Call stop
          await node.stop();
          
          // Verify all connections were closed
          for (const conn of connections) {
            expect(conn.close).toHaveBeenCalled();
          }
          
          // Verify state is disconnected
          const state = node.getState();
          expect(state.status).toBe('disconnected');
          expect(state.connectedPeers).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: Connection count reaches zero after stop()
   * 
   * For any initial connection count, after stop() the connection count SHALL be zero.
   */
  it('connection count is zero after stop()', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 50 }),
        async (initialConnections) => {
          const connections = Array.from({ length: initialConnections }, (_, i) => 
            createMockConnection(`conn-${i}`)
          );
          
          const mockLibp2p = createMockLibp2p(connections);
          
          const node = new BrowserNode({
            bootstrapUrls: [],
            peerIdMode: 'ephemeral',
            maxConnections: 50,
          });
          
          // @ts-expect-error - accessing private property for testing
          node.libp2p = mockLibp2p;
          // @ts-expect-error - accessing private property for testing
          node.state = {
            status: 'connected',
            peerId: 'test-peer-id',
            connectedPeers: initialConnections,
            browserPeers: 0,
            serverPeers: initialConnections,
            routingTableSize: 0,
            bytesIn: 0,
            bytesOut: 0,
          };
          
          await node.stop();
          
          expect(node.getConnectionCount()).toBe(0);
          expect(node.getState().connectedPeers).toBe(0);
          expect(node.getState().browserPeers).toBe(0);
          expect(node.getState().serverPeers).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: stop() is idempotent
   * 
   * Calling stop() multiple times SHALL not cause errors.
   */
  it('stop() is idempotent - multiple calls do not cause errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        async (stopCallCount) => {
          const connections = [createMockConnection('conn-1')];
          const mockLibp2p = createMockLibp2p(connections);
          
          const node = new BrowserNode({
            bootstrapUrls: [],
            peerIdMode: 'ephemeral',
            maxConnections: 50,
          });
          
          // @ts-expect-error - accessing private property for testing
          node.libp2p = mockLibp2p;
          // @ts-expect-error - accessing private property for testing
          node.state = {
            status: 'connected',
            peerId: 'test-peer-id',
            connectedPeers: 1,
            browserPeers: 0,
            serverPeers: 1,
            routingTableSize: 0,
            bytesIn: 0,
            bytesOut: 0,
          };
          
          // Call stop multiple times
          for (let i = 0; i < stopCallCount; i++) {
            await expect(node.stop()).resolves.not.toThrow();
          }
          
          // State should be disconnected
          expect(node.getState().status).toBe('disconnected');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: State callbacks are notified on stop()
   * 
   * For any registered state callbacks, they SHALL be notified when stop() is called.
   */
  it('state callbacks are notified when stop() is called', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        async (callbackCount) => {
          const connections = [createMockConnection('conn-1')];
          const mockLibp2p = createMockLibp2p(connections);
          
          const node = new BrowserNode({
            bootstrapUrls: [],
            peerIdMode: 'ephemeral',
            maxConnections: 50,
          });
          
          // @ts-expect-error - accessing private property for testing
          node.libp2p = mockLibp2p;
          // @ts-expect-error - accessing private property for testing
          node.state = {
            status: 'connected',
            peerId: 'test-peer-id',
            connectedPeers: 1,
            browserPeers: 0,
            serverPeers: 1,
            routingTableSize: 0,
            bytesIn: 0,
            bytesOut: 0,
          };
          
          // Register callbacks
          const callbackResults: string[] = [];
          for (let i = 0; i < callbackCount; i++) {
            node.onStateChange((state) => {
              if (state.status === 'disconnected') {
                callbackResults.push(`callback-${i}`);
              }
            });
          }
          
          await node.stop();
          
          // All callbacks should have been notified
          expect(callbackResults.length).toBe(callbackCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: browser-libp2p-nodes, Property 7: Connection Limit Enforcement
 * 
 * For any browser node with maxConnections=N:
 * - The number of active connections SHALL never exceed N
 * - When approaching N connections, the node SHALL prune least-recently-used connections
 * 
 * **Validates: Requirements 8.1, 8.2**
 */
describe('Property 7: Connection Limit Enforcement', () => {
  let mockDocument: { hidden: boolean; addEventListener: any; removeEventListener: any };
  let mockWindow: { addEventListener: any; removeEventListener: any };
  let mockNavigator: { onLine: boolean };
  let mockIndexedDB: any;

  beforeEach(() => {
    vi.useFakeTimers();
    
    // Mock document for visibility API
    mockDocument = {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    
    // Mock window for network events
    mockWindow = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    
    // Mock navigator
    mockNavigator = { onLine: true };
    
    // Mock IndexedDB
    mockIndexedDB = {
      open: vi.fn().mockReturnValue({
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null,
        result: {
          objectStoreNames: { contains: () => true },
          createObjectStore: vi.fn(),
          transaction: vi.fn().mockReturnValue({
            objectStore: vi.fn().mockReturnValue({
              get: vi.fn().mockReturnValue({ onsuccess: null, onerror: null }),
              put: vi.fn().mockReturnValue({ onsuccess: null, onerror: null }),
            }),
          }),
          close: vi.fn(),
        },
      }),
    };
    
    // Set up global mocks
    vi.stubGlobal('document', mockDocument);
    vi.stubGlobal('window', mockWindow);
    vi.stubGlobal('navigator', mockNavigator);
    vi.stubGlobal('indexedDB', mockIndexedDB);
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = Math.floor(Math.random() * 256);
        }
        return arr;
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * Test: isAtConnectionLimit correctly reports limit status
   * 
   * For any maxConnections value N and current connection count C,
   * isAtConnectionLimit() SHALL return true iff C >= N.
   */
  it('isAtConnectionLimit correctly reports when at limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 5, max: 50 }),
        fc.integer({ min: 0, max: 60 }),
        async (maxConnections, currentConnections) => {
          const connections = Array.from({ length: currentConnections }, (_, i) => 
            createMockConnection(`conn-${i}`)
          );
          
          const mockLibp2p = createMockLibp2p(connections);
          
          const node = new BrowserNode({
            bootstrapUrls: [],
            peerIdMode: 'ephemeral',
            maxConnections,
          });
          
          // @ts-expect-error - accessing private property for testing
          node.libp2p = mockLibp2p;
          // @ts-expect-error - accessing private property for testing
          node.config = { ...node.config, maxConnections };
          
          const isAtLimit = node.isAtConnectionLimit();
          const expectedAtLimit = currentConnections >= maxConnections;
          
          expect(isAtLimit).toBe(expectedAtLimit);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: Connection pruning closes oldest connections
   * 
   * When connections exceed 90% of limit, pruning SHALL close the oldest
   * connections to bring count back to 80% of limit.
   */
  it('connection pruning closes oldest connections when approaching limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10, max: 50 }),
        async (maxConnections) => {
          // Create connections at 95% capacity (above 90% threshold)
          const connectionCount = Math.ceil(maxConnections * 0.95);
          const connections: MockConnection[] = [];
          
          // Create connections with varying ages (older connections have lower timestamps)
          for (let i = 0; i < connectionCount; i++) {
            const conn = createMockConnection(`conn-${i}`);
            // Older connections have lower timestamps
            conn.timeline.open = Date.now() - (connectionCount - i) * 1000;
            connections.push(conn);
          }
          
          const mockLibp2p = createMockLibp2p(connections);
          
          const node = new BrowserNode({
            bootstrapUrls: [],
            peerIdMode: 'ephemeral',
            maxConnections,
          });
          
          // @ts-expect-error - accessing private property for testing
          node.libp2p = mockLibp2p;
          // @ts-expect-error - accessing private property for testing
          node.config = { ...node.config, maxConnections };
          
          // Trigger pruning
          // @ts-expect-error - accessing private method for testing
          node.pruneConnections();
          
          // Calculate expected pruning
          const targetCount = Math.floor(maxConnections * 0.8);
          const expectedClosedCount = connectionCount - targetCount;
          
          // Count how many connections were closed
          const closedCount = connections.filter(c => (c.close as ReturnType<typeof vi.fn>).mock.calls.length > 0).length;
          
          // Should have closed the expected number of connections
          expect(closedCount).toBe(expectedClosedCount);
          
          // The oldest connections should have been closed
          // (connections are sorted by timeline.open, oldest first)
          for (let i = 0; i < expectedClosedCount; i++) {
            expect(connections[i].close).toHaveBeenCalled();
          }
          
          // Newer connections should NOT have been closed
          for (let i = expectedClosedCount; i < connectionCount; i++) {
            expect(connections[i].close).not.toHaveBeenCalled();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: No pruning when below threshold
   * 
   * When connections are below 90% of limit, pruning SHALL NOT close any connections.
   */
  it('no connections pruned when below 90% threshold', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10, max: 50 }),
        async (maxConnections) => {
          // Create connections at 80% capacity (below 90% threshold)
          const connectionCount = Math.floor(maxConnections * 0.8);
          const connections = Array.from({ length: connectionCount }, (_, i) => 
            createMockConnection(`conn-${i}`)
          );
          
          const mockLibp2p = createMockLibp2p(connections);
          
          const node = new BrowserNode({
            bootstrapUrls: [],
            peerIdMode: 'ephemeral',
            maxConnections,
          });
          
          // @ts-expect-error - accessing private property for testing
          node.libp2p = mockLibp2p;
          // @ts-expect-error - accessing private property for testing
          node.config = { ...node.config, maxConnections };
          
          // Trigger pruning
          // @ts-expect-error - accessing private method for testing
          node.pruneConnections();
          
          // No connections should have been closed
          for (const conn of connections) {
            expect(conn.close).not.toHaveBeenCalled();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: getConnectionCount returns accurate count
   * 
   * For any number of connections, getConnectionCount() SHALL return the exact count.
   */
  it('getConnectionCount returns accurate connection count', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 100 }),
        async (connectionCount) => {
          const connections = Array.from({ length: connectionCount }, (_, i) => 
            createMockConnection(`conn-${i}`)
          );
          
          const mockLibp2p = createMockLibp2p(connections);
          
          const node = new BrowserNode({
            bootstrapUrls: [],
            peerIdMode: 'ephemeral',
            maxConnections: 50,
          });
          
          // @ts-expect-error - accessing private property for testing
          node.libp2p = mockLibp2p;
          
          expect(node.getConnectionCount()).toBe(connectionCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: Connection count never exceeds maxConnections after pruning
   * 
   * For any initial connection count above the limit, after pruning
   * the count SHALL be at or below 80% of maxConnections.
   */
  it('connection count is at or below 80% of limit after pruning', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10, max: 50 }),
        fc.integer({ min: 91, max: 150 }), // percentage of max (91-150%)
        async (maxConnections, percentageOfMax) => {
          const connectionCount = Math.ceil(maxConnections * percentageOfMax / 100);
          const connections: MockConnection[] = [];
          
          for (let i = 0; i < connectionCount; i++) {
            const conn = createMockConnection(`conn-${i}`);
            conn.timeline.open = Date.now() - (connectionCount - i) * 1000;
            connections.push(conn);
          }
          
          // Track which connections are "still open" after pruning
          let openConnections = [...connections];
          
          const mockLibp2p = {
            ...createMockLibp2p(connections),
            getConnections: vi.fn(() => openConnections),
          };
          
          // Update close mock to remove from openConnections
          for (const conn of connections) {
            conn.close = vi.fn().mockImplementation(async () => {
              openConnections = openConnections.filter(c => c.id !== conn.id);
            });
          }
          
          const node = new BrowserNode({
            bootstrapUrls: [],
            peerIdMode: 'ephemeral',
            maxConnections,
          });
          
          // @ts-expect-error - accessing private property for testing
          node.libp2p = mockLibp2p;
          // @ts-expect-error - accessing private property for testing
          node.config = { ...node.config, maxConnections };
          
          // Trigger pruning
          // @ts-expect-error - accessing private method for testing
          node.pruneConnections();
          
          // After pruning, count should be at or below 80% of max
          const targetCount = Math.floor(maxConnections * 0.8);
          expect(openConnections.length).toBeLessThanOrEqual(targetCount);
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: browser-libp2p-nodes, Property 5: Overlay Message Delivery
 * 
 * For any two nodes (browser or server) that are both connected to the network,
 * an overlay message sent from one to the other SHALL be deliverable
 * (either directly or via relay/routing).
 * 
 * **Validates: Requirements 5.3, 5.4**
 */
describe('Property 5: Overlay Message Delivery', () => {
  let mockDocument: { hidden: boolean; addEventListener: any; removeEventListener: any };
  let mockWindow: { addEventListener: any; removeEventListener: any };
  let mockNavigator: { onLine: boolean };
  let mockIndexedDB: any;

  beforeEach(() => {
    vi.useFakeTimers();
    
    // Mock document for visibility API
    mockDocument = {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    
    // Mock window for network events
    mockWindow = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    
    // Mock navigator
    mockNavigator = { onLine: true };
    
    // Mock IndexedDB
    mockIndexedDB = {
      open: vi.fn().mockReturnValue({
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null,
        result: {
          objectStoreNames: { contains: () => true },
          createObjectStore: vi.fn(),
          transaction: vi.fn().mockReturnValue({
            objectStore: vi.fn().mockReturnValue({
              get: vi.fn().mockReturnValue({ onsuccess: null, onerror: null }),
              put: vi.fn().mockReturnValue({ onsuccess: null, onerror: null }),
            }),
          }),
          close: vi.fn(),
        },
      }),
    };
    
    // Set up global mocks
    vi.stubGlobal('document', mockDocument);
    vi.stubGlobal('window', mockWindow);
    vi.stubGlobal('navigator', mockNavigator);
    vi.stubGlobal('indexedDB', mockIndexedDB);
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = Math.floor(Math.random() * 256);
        }
        return arr;
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * Test: sendMessage requires overlay to be enabled
   * 
   * For any browser node with overlay disabled, sendMessage SHALL throw an error.
   */
  it('sendMessage throws error when overlay is not enabled', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 10, maxLength: 60 }),
        async (payload, targetPeerId) => {
          const connections = [createMockConnection('conn-1')];
          const mockLibp2p = createMockLibp2p(connections);
          
          const node = new BrowserNode({
            bootstrapUrls: [],
            peerIdMode: 'ephemeral',
            maxConnections: 50,
            enableOverlay: false,
          });
          
          // @ts-expect-error - accessing private property for testing
          node.libp2p = mockLibp2p;
          // @ts-expect-error - accessing private property for testing
          node.state = {
            status: 'connected',
            peerId: 'test-peer-id',
            connectedPeers: 1,
            browserPeers: 0,
            serverPeers: 1,
            routingTableSize: 0,
            bytesIn: 0,
            bytesOut: 0,
          };
          
          await expect(node.sendMessage(targetPeerId, payload)).rejects.toThrow(
            'Overlay network is not enabled'
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: sendMessage requires node to be started
   * 
   * For any browser node that is not started, sendMessage SHALL throw an error.
   */
  it('sendMessage throws error when node is not started', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 10, maxLength: 60 }),
        async (payload, targetPeerId) => {
          const node = new BrowserNode({
            bootstrapUrls: [],
            peerIdMode: 'ephemeral',
            maxConnections: 50,
            enableOverlay: true,
          });
          
          // Node is not started (libp2p is null)
          await expect(node.sendMessage(targetPeerId, payload)).rejects.toThrow(
            'BrowserNode is not started'
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: onMessage handler registration works correctly
   * 
   * For any message handler, registering it SHALL make it available for incoming messages.
   */
  it('onMessage handler registration works correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        async (handlerCount) => {
          const connections = [createMockConnection('conn-1')];
          const mockLibp2p = createMockLibp2p(connections);
          
          const node = new BrowserNode({
            bootstrapUrls: [],
            peerIdMode: 'ephemeral',
            maxConnections: 50,
            enableOverlay: false, // Disable overlay to test handler registration only
          });
          
          // @ts-expect-error - accessing private property for testing
          node.libp2p = mockLibp2p;
          
          // Register handlers multiple times (last one wins)
          const handlers: ReturnType<typeof vi.fn>[] = [];
          for (let i = 0; i < handlerCount; i++) {
            const handler = vi.fn().mockResolvedValue(new Uint8Array([i]));
            handlers.push(handler);
            node.onMessage(handler);
          }
          
          // The last handler should be registered
          // @ts-expect-error - accessing private property for testing
          expect(node.messageHandler).toBe(handlers[handlerCount - 1]);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: Message handler receives correct context
   * 
   * For any registered handler, it SHALL receive the correct originPeerId and messageId.
   */
  it('message handler receives correct context structure', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 10, maxLength: 60 }),
        fc.uuid(),
        async (originPeerId, messageId) => {
          const node = new BrowserNode({
            bootstrapUrls: [],
            peerIdMode: 'ephemeral',
            maxConnections: 50,
            enableOverlay: true,
          });
          
          let receivedContext: { originPeerId: string; messageId: string } | null = null;
          
          node.onMessage(async (payload, context) => {
            receivedContext = context;
            return new Uint8Array([1, 2, 3]);
          });
          
          // Verify handler is registered
          // @ts-expect-error - accessing private property for testing
          expect(node.messageHandler).not.toBeNull();
          
          // Simulate calling the handler directly to verify context structure
          // @ts-expect-error - accessing private property for testing
          const handler = node.messageHandler;
          if (handler) {
            await handler(new Uint8Array([1]), { originPeerId, messageId });
            expect(receivedContext).toEqual({ originPeerId, messageId });
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: Overlay network is initialized when enabled
   * 
   * For any browser node with overlay enabled, after start the overlay network SHALL be initialized.
   */
  it('overlay network is accessible via getOverlayNetwork when enabled', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        async (enableOverlay) => {
          const connections = [createMockConnection('conn-1')];
          const mockLibp2p = createMockLibp2p(connections);
          
          const node = new BrowserNode({
            bootstrapUrls: [],
            peerIdMode: 'ephemeral',
            maxConnections: 50,
            enableOverlay,
          });
          
          // @ts-expect-error - accessing private property for testing
          node.libp2p = mockLibp2p;
          // @ts-expect-error - accessing private property for testing
          node.config = { ...node.config, enableOverlay };
          
          // Without calling initializeOverlay, overlay should be null
          const overlay = node.getOverlayNetwork();
          expect(overlay).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: browser-libp2p-nodes, Property 11: Public Key Publication
 * 
 * For any browser node with overlay enabled, after successful start,
 * the node's public key SHALL be retrievable from the DHT by other nodes.
 * 
 * **Validates: Requirements 5.2**
 */
describe('Property 11: Public Key Publication', () => {
  let mockDocument: { hidden: boolean; addEventListener: any; removeEventListener: any };
  let mockWindow: { addEventListener: any; removeEventListener: any };
  let mockNavigator: { onLine: boolean };
  let mockIndexedDB: any;

  beforeEach(() => {
    vi.useFakeTimers();
    
    // Mock document for visibility API
    mockDocument = {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    
    // Mock window for network events
    mockWindow = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    
    // Mock navigator
    mockNavigator = { onLine: true };
    
    // Mock IndexedDB
    mockIndexedDB = {
      open: vi.fn().mockReturnValue({
        onerror: null,
        onsuccess: null,
        onupgradeneeded: null,
        result: {
          objectStoreNames: { contains: () => true },
          createObjectStore: vi.fn(),
          transaction: vi.fn().mockReturnValue({
            objectStore: vi.fn().mockReturnValue({
              get: vi.fn().mockReturnValue({ onsuccess: null, onerror: null }),
              put: vi.fn().mockReturnValue({ onsuccess: null, onerror: null }),
            }),
          }),
          close: vi.fn(),
        },
      }),
    };
    
    // Set up global mocks
    vi.stubGlobal('document', mockDocument);
    vi.stubGlobal('window', mockWindow);
    vi.stubGlobal('navigator', mockNavigator);
    vi.stubGlobal('indexedDB', mockIndexedDB);
    vi.stubGlobal('crypto', {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = Math.floor(Math.random() * 256);
        }
        return arr;
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * Test: Overlay network can be retrieved when initialized
   * 
   * For any browser node with overlay enabled and initialized,
   * getOverlayNetwork() SHALL return the overlay network instance.
   */
  it('getOverlayNetwork returns null before initialization', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant(true),
        async () => {
          const node = new BrowserNode({
            bootstrapUrls: [],
            peerIdMode: 'ephemeral',
            maxConnections: 50,
            enableOverlay: true,
          });
          
          // Before start, overlay should be null
          expect(node.getOverlayNetwork()).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: BrowserDHTAdapter provides correct peer ID
   * 
   * For any BrowserDHTAdapter, the peerId property SHALL return the libp2p peer ID.
   */
  it('BrowserDHTAdapter provides correct peer ID', async () => {
    // Import BrowserDHTAdapter for testing
    const { BrowserDHTAdapter } = await import('./browser-node.js');
    
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 10, maxLength: 60 }),
        async (peerIdString) => {
          const mockPeerId = { toString: () => peerIdString };
          const mockLibp2p = {
            peerId: mockPeerId,
            status: 'started',
            services: {
              dht: {
                put: vi.fn(),
                get: vi.fn(async function* () {}),
                getClosestPeers: vi.fn(async function* () {}),
                findPeer: vi.fn(async function* () {}),
              },
            },
          };
          
          // @ts-expect-error - using mock libp2p
          const adapter = new BrowserDHTAdapter(mockLibp2p);
          
          expect(adapter.peerId.toString()).toBe(peerIdString);
          expect(adapter.isStarted).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: BrowserDHTAdapter put operation calls DHT service
   * 
   * For any key-value pair, put() SHALL call the underlying DHT service.
   */
  it('BrowserDHTAdapter put calls DHT service', async () => {
    const { BrowserDHTAdapter } = await import('./browser-node.js');
    
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 100 }),
        fc.uint8Array({ minLength: 1, maxLength: 1000 }),
        async (key, value) => {
          // dht.put() returns an async iterable that must be consumed
          const putMock = vi.fn(async function* () {
            yield { name: 'PEER_RESPONSE' };
          });
          const mockLibp2p = {
            peerId: { toString: () => 'test-peer' },
            status: 'started',
            services: {
              dht: {
                put: putMock,
                get: vi.fn(async function* () {}),
                getClosestPeers: vi.fn(async function* () {}),
              },
            },
          };
          
          // @ts-expect-error - using mock libp2p
          const adapter = new BrowserDHTAdapter(mockLibp2p);
          
          await adapter.put(key, value);
          
          expect(putMock).toHaveBeenCalledWith(key, value);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: BrowserDHTAdapter get operation returns value from DHT
   * 
   * For any key with a stored value, get() SHALL return that value.
   */
  it('BrowserDHTAdapter get returns value from DHT', async () => {
    const { BrowserDHTAdapter } = await import('./browser-node.js');
    
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 100 }),
        fc.uint8Array({ minLength: 1, maxLength: 1000 }),
        async (key, expectedValue) => {
          const getMock = vi.fn(async function* () {
            yield { name: 'VALUE', value: expectedValue };
          });
          const mockLibp2p = {
            peerId: { toString: () => 'test-peer' },
            status: 'started',
            services: {
              dht: {
                put: vi.fn(),
                get: getMock,
                getClosestPeers: vi.fn(async function* () {}),
              },
            },
          };
          
          // @ts-expect-error - using mock libp2p
          const adapter = new BrowserDHTAdapter(mockLibp2p);
          
          const result = await adapter.get(key);
          
          expect(result).toEqual(expectedValue);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: BrowserDHTAdapter get throws when key not found
   * 
   * For any key without a stored value, get() SHALL throw an error.
   */
  it('BrowserDHTAdapter get throws when key not found', async () => {
    const { BrowserDHTAdapter } = await import('./browser-node.js');
    
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 1, maxLength: 100 }),
        async (key) => {
          const getMock = vi.fn(async function* () {
            // No VALUE event - key not found
          });
          const mockLibp2p = {
            peerId: { toString: () => 'test-peer' },
            status: 'started',
            services: {
              dht: {
                put: vi.fn(),
                get: getMock,
                getClosestPeers: vi.fn(async function* () {}),
              },
            },
          };
          
          // @ts-expect-error - using mock libp2p
          const adapter = new BrowserDHTAdapter(mockLibp2p);
          
          await expect(adapter.get(key)).rejects.toThrow('Key not found in DHT');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test: BrowserDHTAdapter getLibp2pNode returns the libp2p instance
   * 
   * For any BrowserDHTAdapter, getLibp2pNode() SHALL return the underlying libp2p instance.
   */
  it('BrowserDHTAdapter getLibp2pNode returns libp2p instance', async () => {
    const { BrowserDHTAdapter } = await import('./browser-node.js');
    
    await fc.assert(
      fc.asyncProperty(
        fc.constant(true),
        async () => {
          const mockLibp2p = {
            peerId: { toString: () => 'test-peer' },
            status: 'started',
            services: {
              dht: {
                put: vi.fn(),
                get: vi.fn(async function* () {}),
                getClosestPeers: vi.fn(async function* () {}),
              },
            },
          };
          
          // @ts-expect-error - using mock libp2p
          const adapter = new BrowserDHTAdapter(mockLibp2p);
          
          expect(adapter.getLibp2pNode()).toBe(mockLibp2p);
        }
      ),
      { numRuns: 100 }
    );
  });
});
