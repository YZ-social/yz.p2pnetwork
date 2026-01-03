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
import { DHTConfigBuilder, type DHTNodeConfig } from '../dht/config.js';

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
 * Default test network configuration
 */
const DEFAULT_TEST_NETWORK_OPTIONS: Required<TestNetworkOptions> = {
  numNodes: 3,
  basePort: 0, // Random ports
  startupDelay: 100,
  connectNodes: true,
  nodeConfig: {},
};

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
export async function createTestNetwork(
  options: TestNetworkOptions | number = {}
): Promise<TestNetwork> {
  // Handle simple number argument for convenience
  const opts: TestNetworkOptions = typeof options === 'number' 
    ? { numNodes: options } 
    : options;
  
  const config = { ...DEFAULT_TEST_NETWORK_OPTIONS, ...opts };
  const nodes: DHTNode[] = [];

  try {
    // Create and start nodes
    for (let i = 0; i < config.numNodes; i++) {
      const node = await createTestNode(i, config);
      nodes.push(node);
      
      // Add delay between node starts to avoid port conflicts
      if (i < config.numNodes - 1 && config.startupDelay > 0) {
        await delay(config.startupDelay);
      }
    }

    // Connect nodes to each other if requested
    if (config.connectNodes && nodes.length > 1) {
      await connectAllNodes(nodes);
    }

    // Build and return the TestNetwork object
    return buildTestNetwork(nodes);
  } catch (error) {
    // Cleanup on failure
    await cleanupNodes(nodes);
    throw error;
  }
}

/**
 * Creates a single test node with the given configuration.
 * 
 * @param index - Node index (used for unique configuration)
 * @param config - Test network configuration
 * @returns Started DHTNode
 */
async function createTestNode(
  index: number,
  config: Required<TestNetworkOptions>
): Promise<DHTNode> {
  // Build listen address
  const port = config.basePort === 0 ? 0 : config.basePort + index;
  const listenAddress = `/ip4/127.0.0.1/tcp/${port}`;

  // Create node configuration
  const nodeConfig = DHTConfigBuilder.create()
    .withListenAddresses([listenAddress])
    .withKBucketSize(config.nodeConfig.kBucketSize ?? 20)
    .withMaxConnections(config.nodeConfig.maxConnections ?? 50)
    .withMinConnections(config.nodeConfig.minConnections ?? 0)
    .build();

  // Apply any additional custom config
  const finalConfig: DHTNodeConfig = {
    ...nodeConfig,
    ...config.nodeConfig,
    listenAddresses: [listenAddress], // Ensure listen address is set
  };

  // Create and start the node
  const node = new DHTNode(finalConfig);
  await node.start();

  return node;
}

/**
 * Connects all nodes in the network to each other in a mesh topology.
 * Each node connects to multiple other nodes to ensure proper DHT routing.
 * 
 * @param nodes - Array of started DHT nodes
 */
async function connectAllNodes(nodes: DHTNode[]): Promise<void> {
  if (nodes.length < 2) return;

  // First, connect all nodes to the first node (hub)
  const firstNode = nodes[0];
  const firstNodeAddrs = firstNode.multiaddrs.map(ma => ma.toString());

  for (let i = 1; i < nodes.length; i++) {
    const node = nodes[i];
    try {
      await node.bootstrap(firstNodeAddrs);
    } catch {
      // Ignore bootstrap errors in test network - nodes may still connect
    }
  }

  // Give nodes time to establish initial connections
  await delay(100);

  // Now create mesh connections: each node connects to at least 2 other nodes
  // This ensures the network isn't just a star topology
  for (let i = 1; i < nodes.length; i++) {
    const node = nodes[i];
    
    // Connect to the next node in the ring (creates a ring topology on top of star)
    const nextIndex = (i % (nodes.length - 1)) + 1;
    if (nextIndex !== i && nextIndex < nodes.length) {
      const nextNode = nodes[nextIndex];
      const nextNodeAddrs = nextNode.multiaddrs.map(ma => ma.toString());
      try {
        await node.bootstrap(nextNodeAddrs);
      } catch {
        // Ignore connection errors
      }
    }
    
    // Also connect to a node 2 positions away for better connectivity
    const skipIndex = ((i + 1) % (nodes.length - 1)) + 1;
    if (skipIndex !== i && skipIndex !== nextIndex && skipIndex < nodes.length) {
      const skipNode = nodes[skipIndex];
      const skipNodeAddrs = skipNode.multiaddrs.map(ma => ma.toString());
      try {
        await node.bootstrap(skipNodeAddrs);
      } catch {
        // Ignore connection errors
      }
    }
  }

  // Give nodes time to establish mesh connections
  await delay(200);
}

/**
 * Builds the TestNetwork object with utility functions.
 * 
 * @param nodes - Array of started DHT nodes
 * @returns TestNetwork object
 */
function buildTestNetwork(nodes: DHTNode[]): TestNetwork {
  return {
    nodes,
    
    cleanup: async () => {
      await cleanupNodes(nodes);
    },
    
    getNode: (index: number) => {
      if (index < 0 || index >= nodes.length) {
        throw new Error(`Node index ${index} out of range [0, ${nodes.length - 1}]`);
      }
      return nodes[index];
    },
    
    getPeerIds: () => {
      return nodes.map(node => node.peerId.toString());
    },
    
    getMultiaddrs: (index: number) => {
      if (index < 0 || index >= nodes.length) {
        throw new Error(`Node index ${index} out of range [0, ${nodes.length - 1}]`);
      }
      return nodes[index].multiaddrs.map(ma => ma.toString());
    },
    
    connectNodes: async (fromIndex: number, toIndex: number) => {
      if (fromIndex < 0 || fromIndex >= nodes.length) {
        throw new Error(`From index ${fromIndex} out of range [0, ${nodes.length - 1}]`);
      }
      if (toIndex < 0 || toIndex >= nodes.length) {
        throw new Error(`To index ${toIndex} out of range [0, ${nodes.length - 1}]`);
      }
      if (fromIndex === toIndex) {
        throw new Error('Cannot connect a node to itself');
      }
      
      const targetAddrs = nodes[toIndex].multiaddrs.map(ma => ma.toString());
      await nodes[fromIndex].bootstrap(targetAddrs);
    },
    
    waitForDiscovery: async (timeoutMs = 5000) => {
      const startTime = Date.now();
      const expectedConnections = nodes.length - 1;
      
      while (Date.now() - startTime < timeoutMs) {
        // Check if all nodes have at least one connection
        const allConnected = nodes.every(node => {
          const info = node.getConnectionInfo();
          return info.currentConnections > 0;
        });
        
        if (allConnected) {
          return;
        }
        
        await delay(100);
      }
      
      // Timeout reached - log current state for debugging
      const connectionCounts = nodes.map(node => node.getConnectionInfo().currentConnections);
      throw new Error(
        `Discovery timeout after ${timeoutMs}ms. Connection counts: [${connectionCounts.join(', ')}]`
      );
    },
  };
}

/**
 * Cleanup function to stop all nodes in a network.
 * 
 * @param nodes - Array of DHT nodes to stop
 */
export async function cleanupNodes(nodes: DHTNode[]): Promise<void> {
  const stopPromises = nodes.map(async (node) => {
    try {
      if (node.isStarted) {
        await node.stop();
      }
    } catch {
      // Ignore errors during cleanup
    }
  });
  
  await Promise.all(stopPromises);
}

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
export async function createSingleTestNode(
  config?: Partial<DHTNodeConfig>
): Promise<{ node: DHTNode; cleanup: () => Promise<void> }> {
  const nodeConfig = DHTConfigBuilder.create()
    .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
    .withMaxConnections(50)
    .withMinConnections(0)
    .build();

  const finalConfig: DHTNodeConfig = {
    ...nodeConfig,
    ...config,
  };

  const node = new DHTNode(finalConfig);
  await node.start();

  return {
    node,
    cleanup: async () => {
      try {
        if (node.isStarted) {
          await node.stop();
        }
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Utility function to wait for a condition with timeout.
 * 
 * @param condition - Function that returns true when condition is met
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param intervalMs - Polling interval in milliseconds
 * @throws Error if timeout is reached before condition is met
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 100
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    const result = await condition();
    if (result) {
      return;
    }
    await delay(intervalMs);
  }
  
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

/**
 * Simple delay utility.
 * 
 * @param ms - Milliseconds to delay
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
