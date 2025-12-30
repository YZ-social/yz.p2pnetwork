/**
 * Test network helpers for DHT integration testing
 *
 * Provides utilities for:
 * - Creating test networks with multiple DHT nodes
 * - Connecting nodes together
 * - Cleanup utilities for test teardown
 *
 * Requirements: 7.6
 */
import { DHTNode } from '../dht/node.js';
import { type DHTNodeConfig } from '../dht/config.js';
/**
 * Configuration options for creating a test network
 */
export interface TestNetworkOptions {
    /** Number of nodes to create (default: 3) */
    numNodes?: number;
    /** Base port for TCP listeners (default: 0 for random) */
    basePort?: number;
    /** Delay between node starts in ms (default: 100) */
    startupDelay?: number;
    /** Whether to connect nodes to each other (default: true) */
    connectNodes?: boolean;
    /** Custom configuration to apply to all nodes */
    nodeConfig?: Partial<DHTNodeConfig>;
}
/**
 * Result of creating a test network
 */
export interface TestNetwork {
    /** Array of started DHT nodes */
    nodes: DHTNode[];
    /** Cleanup function to stop all nodes */
    cleanup: () => Promise<void>;
    /** Get a node by index */
    getNode: (index: number) => DHTNode;
    /** Get all peer IDs as strings */
    getPeerIds: () => string[];
    /** Get multiaddrs for a specific node */
    getMultiaddrs: (index: number) => string[];
    /** Connect two nodes by index */
    connectNodes: (fromIndex: number, toIndex: number) => Promise<void>;
    /** Wait for all nodes to discover each other */
    waitForDiscovery: (timeoutMs?: number) => Promise<void>;
}
/**
 * Creates a test network with multiple DHT nodes.
 *
 * The nodes are configured for local testing with TCP transport.
 * By default, nodes are connected to each other after startup.
 *
 * Requirements: 7.6
 *
 * @param options - Configuration options for the test network
 * @returns TestNetwork object with nodes and utilities
 *
 * @example
 * ```typescript
 * const network = await createTestNetwork({ numNodes: 3 });
 * try {
 *   // Use network.nodes for testing
 *   const node1 = network.getNode(0);
 *   const node2 = network.getNode(1);
 *   // ... run tests
 * } finally {
 *   await network.cleanup();
 * }
 * ```
 */
export declare function createTestNetwork(options?: TestNetworkOptions | number): Promise<TestNetwork>;
/**
 * Cleanup function to stop all nodes in a network.
 *
 * @param nodes - Array of DHT nodes to stop
 */
export declare function cleanupNodes(nodes: DHTNode[]): Promise<void>;
/**
 * Creates a single test node for simple test cases.
 *
 * @param config - Optional configuration overrides
 * @returns Started DHTNode and cleanup function
 *
 * @example
 * ```typescript
 * const { node, cleanup } = await createSingleTestNode();
 * try {
 *   // Use node for testing
 * } finally {
 *   await cleanup();
 * }
 * ```
 */
export declare function createSingleTestNode(config?: Partial<DHTNodeConfig>): Promise<{
    node: DHTNode;
    cleanup: () => Promise<void>;
}>;
/**
 * Utility function to wait for a condition with timeout.
 *
 * @param condition - Function that returns true when condition is met
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param intervalMs - Polling interval in milliseconds
 * @throws Error if timeout is reached before condition is met
 */
export declare function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs?: number, intervalMs?: number): Promise<void>;
//# sourceMappingURL=network.d.ts.map