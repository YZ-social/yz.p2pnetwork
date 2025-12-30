/**
 * Tests for test network helpers
 * 
 * Requirements: 7.6
 */

import { describe, it, expect, afterEach } from 'vitest';
import { 
  createTestNetwork, 
  createSingleTestNode, 
  cleanupNodes,
  waitFor,
  type TestNetwork 
} from './network.js';

describe('Test Network Helpers', () => {
  let network: TestNetwork | null = null;

  afterEach(async () => {
    // Cleanup any created network
    if (network) {
      await network.cleanup();
      network = null;
    }
  });

  describe('createTestNetwork', () => {
    it('creates a network with the specified number of nodes', async () => {
      network = await createTestNetwork({ numNodes: 2, connectNodes: false });
      
      expect(network.nodes).toHaveLength(2);
      expect(network.nodes[0].isStarted).toBe(true);
      expect(network.nodes[1].isStarted).toBe(true);
    }, 30000);

    it('accepts a simple number argument', async () => {
      network = await createTestNetwork(2);
      
      expect(network.nodes).toHaveLength(2);
    }, 30000);

    it('provides getNode utility', async () => {
      network = await createTestNetwork({ numNodes: 2, connectNodes: false });
      
      const node0 = network.getNode(0);
      const node1 = network.getNode(1);
      
      expect(node0).toBe(network.nodes[0]);
      expect(node1).toBe(network.nodes[1]);
    }, 30000);

    it('throws for invalid node index', async () => {
      network = await createTestNetwork({ numNodes: 2, connectNodes: false });
      
      expect(() => network!.getNode(-1)).toThrow('out of range');
      expect(() => network!.getNode(2)).toThrow('out of range');
    }, 30000);

    it('provides getPeerIds utility', async () => {
      network = await createTestNetwork({ numNodes: 2, connectNodes: false });
      
      const peerIds = network.getPeerIds();
      
      expect(peerIds).toHaveLength(2);
      expect(typeof peerIds[0]).toBe('string');
      expect(typeof peerIds[1]).toBe('string');
      expect(peerIds[0]).not.toBe(peerIds[1]);
    }, 30000);

    it('provides getMultiaddrs utility', async () => {
      network = await createTestNetwork({ numNodes: 2, connectNodes: false });
      
      const addrs = network.getMultiaddrs(0);
      
      expect(addrs.length).toBeGreaterThan(0);
      expect(addrs[0]).toContain('/ip4/127.0.0.1/tcp/');
    }, 30000);

    it('cleanup stops all nodes', async () => {
      network = await createTestNetwork({ numNodes: 2, connectNodes: false });
      
      await network.cleanup();
      
      expect(network.nodes[0].isStarted).toBe(false);
      expect(network.nodes[1].isStarted).toBe(false);
      
      // Prevent double cleanup in afterEach
      network = null;
    }, 30000);
  });

  describe('createSingleTestNode', () => {
    it('creates a single started node', async () => {
      const { node, cleanup } = await createSingleTestNode();
      
      try {
        expect(node.isStarted).toBe(true);
        expect(node.multiaddrs.length).toBeGreaterThan(0);
      } finally {
        await cleanup();
      }
    }, 30000);

    it('accepts custom configuration', async () => {
      const { node, cleanup } = await createSingleTestNode({
        kBucketSize: 10,
      });
      
      try {
        expect(node.isStarted).toBe(true);
      } finally {
        await cleanup();
      }
    }, 30000);
  });

  describe('cleanupNodes', () => {
    it('stops all provided nodes', async () => {
      network = await createTestNetwork({ numNodes: 2, connectNodes: false });
      const nodes = [...network.nodes];
      
      await cleanupNodes(nodes);
      
      expect(nodes[0].isStarted).toBe(false);
      expect(nodes[1].isStarted).toBe(false);
      
      // Prevent double cleanup
      network = null;
    }, 30000);

    it('handles already stopped nodes gracefully', async () => {
      network = await createTestNetwork({ numNodes: 1, connectNodes: false });
      const nodes = [...network.nodes];
      
      await nodes[0].stop();
      
      // Should not throw
      await cleanupNodes(nodes);
      
      network = null;
    }, 30000);
  });

  describe('waitFor', () => {
    it('resolves when condition becomes true', async () => {
      let counter = 0;
      const condition = () => {
        counter++;
        return counter >= 3;
      };
      
      await waitFor(condition, 5000, 10);
      
      expect(counter).toBeGreaterThanOrEqual(3);
    });

    it('throws on timeout', async () => {
      const condition = () => false;
      
      await expect(waitFor(condition, 100, 10)).rejects.toThrow('not met within');
    });

    it('supports async conditions', async () => {
      let counter = 0;
      const condition = async () => {
        counter++;
        return counter >= 2;
      };
      
      await waitFor(condition, 5000, 10);
      
      expect(counter).toBeGreaterThanOrEqual(2);
    });
  });
});
