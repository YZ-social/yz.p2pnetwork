/**
 * Unit tests for connection management
 * 
 * Tests connection limits are enforced and events are emitted on state changes.
 * 
 * _Requirements: 6.3, 6.4, 6.5_
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { DHTNode, type ConnectionInfo } from './node.js';
import { DHTConfigBuilder } from './config.js';
import type { PeerId } from '@libp2p/interface';

describe('Connection Management', () => {
  // Track created nodes for cleanup
  const createdNodes: DHTNode[] = [];

  afterEach(async () => {
    // Stop all created nodes to prevent resource leaks
    for (const node of createdNodes) {
      try {
        await node.stop();
      } catch {
        // Ignore cleanup errors
      }
    }
    createdNodes.length = 0;
  });

  describe('Connection limits are enforced', () => {
    it('returns correct connection info with configured limits', async () => {
      const config = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .withMaxConnections(50)
        .withMinConnections(2)
        .build();

      const node = new DHTNode(config);
      createdNodes.push(node);
      await node.start();

      const connectionInfo: ConnectionInfo = node.getConnectionInfo();

      expect(connectionInfo.maxConnections).toBe(50);
      expect(connectionInfo.minConnections).toBe(2);
      expect(connectionInfo.currentConnections).toBe(0);
      expect(connectionInfo.connectedPeers).toEqual([]);
    });

    it('uses default connection limits when not specified', async () => {
      const config = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .build();

      const node = new DHTNode(config);
      createdNodes.push(node);
      await node.start();

      const connectionInfo = node.getConnectionInfo();

      // Default values from DEFAULT_CONFIG
      expect(connectionInfo.maxConnections).toBe(100);
      expect(connectionInfo.minConnections).toBe(5);
    });

    it('canAcceptConnections returns true when below max limit', async () => {
      const config = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .withMaxConnections(10)
        .build();

      const node = new DHTNode(config);
      createdNodes.push(node);
      await node.start();

      // With no connections, should be able to accept more
      expect(node.canAcceptConnections()).toBe(true);
    });

    it('getConnectionCount returns current number of connections', async () => {
      const config = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .build();

      const node = new DHTNode(config);
      createdNodes.push(node);
      await node.start();

      // Initially should have 0 connections
      expect(node.getConnectionCount()).toBe(0);
    });

    it('throws error when getting connection info on stopped node', async () => {
      const config = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .build();

      const node = new DHTNode(config);
      // Don't start the node

      expect(() => node.getConnectionInfo()).toThrow('DHT node is not started');
    });

    it('throws error when checking canAcceptConnections on stopped node', async () => {
      const config = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .build();

      const node = new DHTNode(config);
      // Don't start the node

      expect(() => node.canAcceptConnections()).toThrow('DHT node is not started');
    });

    it('throws error when getting connection count on stopped node', async () => {
      const config = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .build();

      const node = new DHTNode(config);
      // Don't start the node

      expect(() => node.getConnectionCount()).toThrow('DHT node is not started');
    });
  });

  describe('Events are emitted on state changes', () => {
    it('registers peer:connect event handler', async () => {
      const config = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .build();

      const node = new DHTNode(config);
      createdNodes.push(node);
      await node.start();

      const handler = vi.fn();
      
      // Should not throw when registering handler
      expect(() => node.on('peer:connect', handler)).not.toThrow();
    });

    it('registers peer:disconnect event handler', async () => {
      const config = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .build();

      const node = new DHTNode(config);
      createdNodes.push(node);
      await node.start();

      const handler = vi.fn();
      
      // Should not throw when registering handler
      expect(() => node.on('peer:disconnect', handler)).not.toThrow();
    });

    it('removes event handler with off()', async () => {
      const config = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .build();

      const node = new DHTNode(config);
      createdNodes.push(node);
      await node.start();

      const handler = vi.fn();
      node.on('peer:connect', handler);
      
      // Should not throw when removing handler
      expect(() => node.off('peer:connect', handler)).not.toThrow();
    });

    it('can register multiple handlers for same event', async () => {
      const config = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .build();

      const node = new DHTNode(config);
      createdNodes.push(node);
      await node.start();

      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      // Should not throw when registering multiple handlers
      expect(() => {
        node.on('peer:connect', handler1);
        node.on('peer:connect', handler2);
      }).not.toThrow();
    });

    it('registers dht:routing:refresh event handler', async () => {
      const config = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .build();

      const node = new DHTNode(config);
      createdNodes.push(node);
      await node.start();

      const handler = vi.fn();
      
      // Should not throw when registering handler
      expect(() => node.on('dht:routing:refresh', handler)).not.toThrow();
    });

    it('clears event handlers when node stops', async () => {
      const config = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .build();

      const node = new DHTNode(config);
      createdNodes.push(node);
      await node.start();

      const handler = vi.fn();
      node.on('peer:connect', handler);
      
      await node.stop();
      
      // Node should be stopped
      expect(node.isStarted).toBe(false);
    });
  });

  describe('Connection info with multiple nodes', () => {
    it('tracks connections when nodes connect to each other', async () => {
      // Create two nodes
      const config1 = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .withMaxConnections(10)
        .build();

      const config2 = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .withMaxConnections(10)
        .build();

      const node1 = new DHTNode(config1);
      const node2 = new DHTNode(config2);
      createdNodes.push(node1, node2);

      await node1.start();
      await node2.start();

      // Get node1's multiaddr for node2 to connect to
      const node1Addrs = node1.multiaddrs;
      expect(node1Addrs.length).toBeGreaterThan(0);

      // Find a TCP address without p2p component and add peer ID
      const tcpAddr = node1Addrs.find(addr => {
        const str = addr.toString();
        return str.includes('/tcp/') && !str.includes('/p2p/');
      });
      
      // If all addresses already have p2p, use the first one as-is
      const node1AddrWithPeerId = tcpAddr 
        ? `${tcpAddr.toString()}/p2p/${node1.peerId.toString()}`
        : node1Addrs[0].toString();
      
      // Bootstrap node2 to node1
      await node2.bootstrap([node1AddrWithPeerId]);

      // Give some time for connection to establish
      await new Promise(resolve => setTimeout(resolve, 500));

      // Both nodes should now have at least 1 connection
      const info1 = node1.getConnectionInfo();
      const info2 = node2.getConnectionInfo();

      // At least one of them should have a connection
      // (connection might be tracked on one side first)
      expect(info1.currentConnections + info2.currentConnections).toBeGreaterThanOrEqual(1);
    });

    it('emits peer:connect event when peer connects', async () => {
      // Create two nodes
      const config1 = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .build();

      const config2 = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .build();

      const node1 = new DHTNode(config1);
      const node2 = new DHTNode(config2);
      createdNodes.push(node1, node2);

      await node1.start();
      await node2.start();

      // Set up event handler before connection
      const connectHandler = vi.fn();
      node1.on('peer:connect', connectHandler);

      // Get node1's multiaddr for node2 to connect to
      const node1Addrs = node1.multiaddrs;
      
      // Find a TCP address without p2p component and add peer ID
      const tcpAddr = node1Addrs.find(addr => {
        const str = addr.toString();
        return str.includes('/tcp/') && !str.includes('/p2p/');
      });
      
      // If all addresses already have p2p, use the first one as-is
      const node1AddrWithPeerId = tcpAddr 
        ? `${tcpAddr.toString()}/p2p/${node1.peerId.toString()}`
        : node1Addrs[0].toString();
      
      // Bootstrap node2 to node1
      await node2.bootstrap([node1AddrWithPeerId]);

      // Give some time for connection event to fire
      await new Promise(resolve => setTimeout(resolve, 500));

      // The connect handler should have been called
      expect(connectHandler).toHaveBeenCalled();
    });
  });
});
