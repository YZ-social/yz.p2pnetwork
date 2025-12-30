/**
 * Unit tests for routing table diagnostics.
 *
 * Tests the getRoutingTableInfo function and related functionality.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DHTNode } from './node.js';
import { DHTConfigBuilder } from './config.js';
describe('Routing Table Diagnostics', () => {
    let node;
    beforeAll(async () => {
        const config = DHTConfigBuilder.create()
            .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
            .build();
        node = new DHTNode(config);
        await node.start();
    });
    afterAll(async () => {
        if (node?.isStarted) {
            await node.stop();
        }
    });
    describe('getRoutingTableInfo', () => {
        it('should return routing table info with local peer ID', () => {
            const info = node.getRoutingTableInfo();
            expect(info).toBeDefined();
            expect(info.localPeerId).toBe(node.peerId.toString());
        });
        it('should return routing table info with buckets array', () => {
            const info = node.getRoutingTableInfo();
            expect(info.buckets).toBeDefined();
            expect(Array.isArray(info.buckets)).toBe(true);
        });
        it('should return routing table info with totalPeers count', () => {
            const info = node.getRoutingTableInfo();
            expect(typeof info.totalPeers).toBe('number');
            expect(info.totalPeers).toBeGreaterThanOrEqual(0);
        });
        it('should have consistent totalPeers with bucket peer counts', () => {
            const info = node.getRoutingTableInfo();
            const sumOfPeers = info.buckets.reduce((sum, bucket) => sum + bucket.peers.length, 0);
            expect(info.totalPeers).toBe(sumOfPeers);
        });
        it('should have buckets sorted by index', () => {
            const info = node.getRoutingTableInfo();
            for (let i = 1; i < info.buckets.length; i++) {
                expect(info.buckets[i].index).toBeGreaterThan(info.buckets[i - 1].index);
            }
        });
    });
    describe('error handling', () => {
        it('should throw error when node is not started', async () => {
            const config = DHTConfigBuilder.create()
                .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
                .build();
            const unstartedNode = new DHTNode(config);
            expect(() => unstartedNode.getRoutingTableInfo()).toThrow('DHT node is not started');
        });
    });
});
//# sourceMappingURL=routing.test.js.map