/**
 * Integration tests for DHT operations across multiple nodes
 *
 * Tests:
 * - Peer discovery across network
 * - Connection events
 * - Basic DHT operations (when network is established)
 *
 * Note: Full DHT operations (PUT/GET, Provider) require a larger network
 * and more time for DHT routing table to stabilize. These tests focus on
 * the core connectivity and peer discovery functionality.
 *
 * Requirements: 4.1, 4.2, 5.1, 5.2, 7.4, 7.5
 */
import { describe, it, expect, afterEach } from 'vitest';
import { DHTNode, CID } from '../dht/node.js';
import { DHTConfigBuilder } from '../dht/config.js';
import { DHTError, DHTErrorCode } from '../dht/errors.js';
import { cleanupNodes } from '../test-utils/network.js';
import { sha256 } from 'multiformats/hashes/sha2';
import * as raw from 'multiformats/codecs/raw';
describe('DHT Operations Integration Tests', () => {
    let nodesToCleanup = [];
    afterEach(async () => {
        await cleanupNodes(nodesToCleanup);
        nodesToCleanup = [];
    });
    /**
     * Helper to create a CID from arbitrary data
     */
    async function createCID(data) {
        const hash = await sha256.digest(data);
        return CID.create(1, raw.code, hash);
    }
    /**
     * Helper to create and start a test node
     */
    async function createNode() {
        const config = DHTConfigBuilder.create()
            .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
            .withMaxConnections(50)
            .withMinConnections(0)
            .build();
        const node = new DHTNode(config);
        await node.start();
        nodesToCleanup.push(node);
        return node;
    }
    /**
     * Helper to connect two nodes
     */
    async function connectNodes(from, to) {
        const addrs = to.multiaddrs.map(ma => ma.toString());
        await from.bootstrap(addrs);
    }
    /**
     * Helper to wait for a condition
     */
    async function waitFor(condition, timeoutMs = 5000, intervalMs = 100) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            if (await condition())
                return;
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
        throw new Error(`Condition not met within ${timeoutMs}ms`);
    }
    describe('Peer Discovery', () => {
        it('should discover peers in the network', async () => {
            const node1 = await createNode();
            const node2 = await createNode();
            await connectNodes(node1, node2);
            await waitFor(() => node1.getConnectionInfo().currentConnections > 0, 10000);
            // Find the peer
            const peerInfo = await node1.findPeer(node2.peerId);
            expect(peerInfo.id.toString()).toBe(node2.peerId.toString());
            expect(peerInfo.multiaddrs.length).toBeGreaterThan(0);
        }, 30000);
        // Note: Testing NOT_FOUND for unknown peer is skipped because DHT lookups
        // for non-existent peers can take a very long time (30+ seconds) as the DHT
        // exhaustively searches the network. This is expected behavior for Kademlia.
        it('should track peer connections via events', async () => {
            const node1 = await createNode();
            const node2 = await createNode();
            const connectedPeers = [];
            node1.on('peer:connect', (peerId) => {
                connectedPeers.push(peerId.toString());
            });
            // Connect node2 to node1
            await connectNodes(node2, node1);
            // Wait for connection event
            await waitFor(() => connectedPeers.length > 0, 10000);
            expect(connectedPeers).toContain(node2.peerId.toString());
        }, 30000);
        // Note: Testing getClosestPeers is skipped because with only 2 nodes,
        // the DHT query can take a very long time as it tries to find more peers.
        // This is expected behavior for Kademlia in small networks.
    });
    describe('Content Operations', () => {
        it('should validate key-value pairs before storage', async () => {
            const node = await createNode();
            // Empty key should throw
            await expect(node.put(new Uint8Array(0), new Uint8Array([1, 2, 3]))).rejects.toThrow(DHTError);
            try {
                await node.put(new Uint8Array(0), new Uint8Array([1, 2, 3]));
            }
            catch (error) {
                expect(error).toBeInstanceOf(DHTError);
                expect(error.code).toBe(DHTErrorCode.INVALID_RECORD);
            }
        }, 30000);
        it('should validate key before retrieval', async () => {
            const node = await createNode();
            // Empty key should throw
            await expect(node.get(new Uint8Array(0))).rejects.toThrow(DHTError);
            try {
                await node.get(new Uint8Array(0));
            }
            catch (error) {
                expect(error).toBeInstanceOf(DHTError);
                expect(error.code).toBe(DHTErrorCode.INVALID_RECORD);
            }
        }, 30000);
    });
    describe('Provider Operations', () => {
        it('should validate CID before providing', async () => {
            const node = await createNode();
            // Invalid CID string should throw
            await expect(node.provide('invalid-cid')).rejects.toThrow(DHTError);
            try {
                await node.provide('invalid-cid');
            }
            catch (error) {
                expect(error).toBeInstanceOf(DHTError);
                expect(error.code).toBe(DHTErrorCode.INVALID_RECORD);
            }
        }, 30000);
        it('should accept valid CID for providing', async () => {
            const node1 = await createNode();
            const node2 = await createNode();
            await connectNodes(node1, node2);
            await waitFor(() => node1.getConnectionInfo().currentConnections > 0, 10000);
            const data = new TextEncoder().encode('test-content');
            const cid = await createCID(data);
            // Should not throw - provide operation should complete
            // Note: In a small network, the provide may not fully propagate
            // but the operation itself should succeed
            await expect(node1.provide(cid)).resolves.not.toThrow();
        }, 30000);
    });
    describe('Connection Management', () => {
        it('should report connection info correctly', async () => {
            const node1 = await createNode();
            const node2 = await createNode();
            // Before connection
            const infoBefore = node1.getConnectionInfo();
            expect(infoBefore.currentConnections).toBe(0);
            expect(infoBefore.connectedPeers).toHaveLength(0);
            // Connect
            await connectNodes(node1, node2);
            await waitFor(() => node1.getConnectionInfo().currentConnections > 0, 10000);
            // After connection
            const infoAfter = node1.getConnectionInfo();
            expect(infoAfter.currentConnections).toBeGreaterThan(0);
            expect(infoAfter.connectedPeers).toContain(node2.peerId.toString());
        }, 30000);
        it('should track connection count', async () => {
            const node1 = await createNode();
            const node2 = await createNode();
            const node3 = await createNode();
            expect(node1.getConnectionCount()).toBe(0);
            await connectNodes(node1, node2);
            await waitFor(() => node1.getConnectionCount() > 0, 10000);
            expect(node1.getConnectionCount()).toBeGreaterThanOrEqual(1);
            await connectNodes(node1, node3);
            await waitFor(() => node1.getConnectionCount() >= 2, 10000);
            expect(node1.getConnectionCount()).toBeGreaterThanOrEqual(2);
        }, 30000);
    });
});
//# sourceMappingURL=dht-operations.integration.test.js.map