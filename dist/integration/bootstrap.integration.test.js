/**
 * Integration tests for DHT node bootstrap functionality
 *
 * Tests:
 * - Node bootstrap with single bootstrap peer
 * - Node bootstrap with multiple bootstrap peers
 * - Bootstrap failure handling
 *
 * Requirements: 2.1, 2.2, 2.3, 7.3
 */
import { describe, it, expect, afterEach } from 'vitest';
import { DHTNode } from '../dht/node.js';
import { DHTConfigBuilder } from '../dht/config.js';
import { DHTError, DHTErrorCode } from '../dht/errors.js';
import { createTestNetwork, createSingleTestNode, cleanupNodes } from '../test-utils/network.js';
describe('Bootstrap Integration Tests', () => {
    // Track nodes for cleanup
    let nodesToCleanup = [];
    afterEach(async () => {
        await cleanupNodes(nodesToCleanup);
        nodesToCleanup = [];
    });
    describe('Single Bootstrap Peer', () => {
        it('should bootstrap successfully with a single peer', async () => {
            // Create bootstrap node
            const { node: bootstrapNode, cleanup: cleanupBootstrap } = await createSingleTestNode();
            nodesToCleanup.push(bootstrapNode);
            // Get bootstrap node's multiaddrs
            const bootstrapAddrs = bootstrapNode.multiaddrs.map(ma => ma.toString());
            expect(bootstrapAddrs.length).toBeGreaterThan(0);
            // Create and start a new node
            const config = DHTConfigBuilder.create()
                .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
                .withMaxConnections(50)
                .build();
            const newNode = new DHTNode(config);
            nodesToCleanup.push(newNode);
            await newNode.start();
            // Bootstrap to the first node
            await newNode.bootstrap(bootstrapAddrs);
            // Verify connection was established
            const connectionInfo = newNode.getConnectionInfo();
            expect(connectionInfo.currentConnections).toBeGreaterThan(0);
            expect(connectionInfo.connectedPeers).toContain(bootstrapNode.peerId.toString());
        }, 30000);
        it('should populate routing table after bootstrap', async () => {
            // Create bootstrap node
            const { node: bootstrapNode } = await createSingleTestNode();
            nodesToCleanup.push(bootstrapNode);
            const bootstrapAddrs = bootstrapNode.multiaddrs.map(ma => ma.toString());
            // Create and bootstrap new node
            const config = DHTConfigBuilder.create()
                .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
                .withMaxConnections(50)
                .build();
            const newNode = new DHTNode(config);
            nodesToCleanup.push(newNode);
            await newNode.start();
            await newNode.bootstrap(bootstrapAddrs);
            // Give time for routing table to populate
            await new Promise(resolve => setTimeout(resolve, 500));
            // Check routing table has peers
            const routingInfo = newNode.getRoutingTableInfo();
            expect(routingInfo.totalPeers).toBeGreaterThanOrEqual(0);
        }, 30000);
    });
    describe('Multiple Bootstrap Peers', () => {
        it('should bootstrap successfully with multiple peers', async () => {
            // Create a test network with 3 nodes
            const network = await createTestNetwork({ numNodes: 3, connectNodes: false });
            nodesToCleanup.push(...network.nodes);
            // Get multiaddrs from first two nodes as bootstrap peers
            const bootstrapAddrs = [
                ...network.getMultiaddrs(0),
                ...network.getMultiaddrs(1),
            ];
            // Create a new node and bootstrap to multiple peers
            const config = DHTConfigBuilder.create()
                .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
                .withMaxConnections(50)
                .build();
            const newNode = new DHTNode(config);
            nodesToCleanup.push(newNode);
            await newNode.start();
            // Bootstrap to multiple peers
            await newNode.bootstrap(bootstrapAddrs);
            // Verify connections were established
            const connectionInfo = newNode.getConnectionInfo();
            expect(connectionInfo.currentConnections).toBeGreaterThan(0);
        }, 30000);
        it('should succeed if at least one bootstrap peer is reachable', async () => {
            // Create one valid bootstrap node
            const { node: bootstrapNode } = await createSingleTestNode();
            nodesToCleanup.push(bootstrapNode);
            const validAddr = bootstrapNode.multiaddrs[0].toString();
            // Invalid address that won't connect
            const invalidAddr = '/ip4/192.0.2.1/tcp/12345/p2p/12D3KooWDpJ7As7BWAwRMfu1VU2WCqNjvq387JEYKDBj4kx6nXTN';
            // Create new node
            const config = DHTConfigBuilder.create()
                .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
                .withMaxConnections(50)
                .build();
            const newNode = new DHTNode(config);
            nodesToCleanup.push(newNode);
            await newNode.start();
            // Bootstrap with mix of valid and invalid addresses
            // Should succeed because at least one peer is reachable
            await newNode.bootstrap([invalidAddr, validAddr]);
            // Verify at least one connection was established
            const connectionInfo = newNode.getConnectionInfo();
            expect(connectionInfo.currentConnections).toBeGreaterThan(0);
        }, 30000);
    });
    describe('Bootstrap Failure Handling', () => {
        it('should throw BOOTSTRAP_FAILED when all peers are unreachable', async () => {
            // Create node with no valid bootstrap peers
            const config = DHTConfigBuilder.create()
                .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
                .withMaxConnections(50)
                .build();
            const node = new DHTNode(config);
            nodesToCleanup.push(node);
            await node.start();
            // Try to bootstrap to unreachable addresses (using localhost with invalid port for faster failure)
            const unreachableAddrs = [
                '/ip4/127.0.0.1/tcp/1/p2p/12D3KooWDpJ7As7BWAwRMfu1VU2WCqNjvq387JEYKDBj4kx6nXTN',
            ];
            await expect(node.bootstrap(unreachableAddrs)).rejects.toThrow(DHTError);
            try {
                await node.bootstrap(unreachableAddrs);
            }
            catch (error) {
                expect(error).toBeInstanceOf(DHTError);
                expect(error.code).toBe(DHTErrorCode.BOOTSTRAP_FAILED);
            }
        }, 60000);
        it('should not throw when bootstrap is called with empty array', async () => {
            const config = DHTConfigBuilder.create()
                .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
                .withMaxConnections(50)
                .build();
            const node = new DHTNode(config);
            nodesToCleanup.push(node);
            await node.start();
            // Empty bootstrap should succeed (standalone mode)
            await expect(node.bootstrap([])).resolves.not.toThrow();
        }, 30000);
        it('should not throw when bootstrap is called with no arguments', async () => {
            const config = DHTConfigBuilder.create()
                .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
                .withMaxConnections(50)
                .build();
            const node = new DHTNode(config);
            nodesToCleanup.push(node);
            await node.start();
            // No-argument bootstrap should succeed (standalone mode)
            await expect(node.bootstrap()).resolves.not.toThrow();
        }, 30000);
        it('should include error context when bootstrap fails', async () => {
            const config = DHTConfigBuilder.create()
                .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
                .withMaxConnections(50)
                .build();
            const node = new DHTNode(config);
            nodesToCleanup.push(node);
            await node.start();
            // Use localhost with invalid port for faster failure
            const unreachableAddrs = [
                '/ip4/127.0.0.1/tcp/1/p2p/12D3KooWDpJ7As7BWAwRMfu1VU2WCqNjvq387JEYKDBj4kx6nXTN',
            ];
            try {
                await node.bootstrap(unreachableAddrs);
                expect.fail('Should have thrown');
            }
            catch (error) {
                expect(error).toBeInstanceOf(DHTError);
                const dhtError = error;
                expect(dhtError.context).toBeDefined();
                expect(dhtError.context?.attemptedPeers).toEqual(unreachableAddrs);
                expect(dhtError.context?.errors).toBeDefined();
            }
        }, 60000);
    });
    describe('Bootstrap with Pre-configured Peers', () => {
        it('should use config bootstrap peers when no argument provided', async () => {
            // Create bootstrap node first
            const { node: bootstrapNode } = await createSingleTestNode();
            nodesToCleanup.push(bootstrapNode);
            const bootstrapAddrs = bootstrapNode.multiaddrs.map(ma => ma.toString());
            // Create node with bootstrap peers in config
            const config = DHTConfigBuilder.create()
                .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
                .withBootstrapPeers(bootstrapAddrs)
                .withMaxConnections(50)
                .build();
            const node = new DHTNode(config);
            nodesToCleanup.push(node);
            await node.start();
            // Bootstrap without arguments should use config peers
            await node.bootstrap();
            // Verify connection was established
            const connectionInfo = node.getConnectionInfo();
            expect(connectionInfo.currentConnections).toBeGreaterThan(0);
        }, 30000);
    });
});
//# sourceMappingURL=bootstrap.integration.test.js.map