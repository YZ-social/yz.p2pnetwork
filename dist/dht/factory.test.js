/**
 * Unit tests for libp2p node factory
 *
 * Tests node creation with valid config, invalid config handling, and WebRTC configuration.
 *
 * _Requirements: 1.1, 1.4, 2.1_
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createLibp2pNode } from './factory.js';
import { DHTConfigBuilder } from './config.js';
import { DHTError, DHTErrorCode } from './errors.js';
describe('Node Factory - createLibp2pNode', () => {
    // Track created nodes for cleanup
    const createdNodes = [];
    afterEach(async () => {
        // Stop all created nodes to prevent resource leaks
        for (const node of createdNodes) {
            try {
                await node.stop();
            }
            catch {
                // Ignore cleanup errors
            }
        }
        createdNodes.length = 0;
    });
    describe('Node creation with valid config', () => {
        it('creates a node with minimal valid configuration', async () => {
            const config = {
                listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
            };
            const node = await createLibp2pNode(config);
            createdNodes.push(node);
            expect(node).toBeDefined();
            expect(node.peerId).toBeDefined();
        });
        it('creates a node using DHTConfigBuilder', async () => {
            const config = DHTConfigBuilder.create()
                .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
                .withKBucketSize(10)
                .withAlpha(3)
                .build();
            const node = await createLibp2pNode(config);
            createdNodes.push(node);
            expect(node).toBeDefined();
            expect(node.peerId).toBeDefined();
        });
        it('creates a node with custom connection limits', async () => {
            const config = {
                listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
                maxConnections: 50,
                minConnections: 2,
            };
            const node = await createLibp2pNode(config);
            createdNodes.push(node);
            expect(node).toBeDefined();
        });
        it('creates a node with circuit relay enabled', async () => {
            const config = {
                listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
                circuitRelay: { enabled: true },
            };
            const node = await createLibp2pNode(config);
            createdNodes.push(node);
            expect(node).toBeDefined();
        });
    });
    describe('Node creation with invalid config throws', () => {
        it('throws DHTError with INVALID_CONFIG when listenAddresses is empty', async () => {
            const config = {
                listenAddresses: [],
            };
            await expect(createLibp2pNode(config)).rejects.toThrow(DHTError);
            await expect(createLibp2pNode(config)).rejects.toMatchObject({
                code: DHTErrorCode.INVALID_CONFIG,
            });
        });
        it('throws DHTError with INVALID_CONFIG when kBucketSize is invalid', async () => {
            const config = {
                listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
                kBucketSize: 0,
            };
            await expect(createLibp2pNode(config)).rejects.toThrow(DHTError);
            await expect(createLibp2pNode(config)).rejects.toMatchObject({
                code: DHTErrorCode.INVALID_CONFIG,
            });
        });
        it('throws DHTError with INVALID_CONFIG when alpha is out of range', async () => {
            const config = {
                listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
                alpha: 25,
            };
            await expect(createLibp2pNode(config)).rejects.toThrow(DHTError);
            await expect(createLibp2pNode(config)).rejects.toMatchObject({
                code: DHTErrorCode.INVALID_CONFIG,
            });
        });
        it('throws DHTError with INVALID_CONFIG when minConnections exceeds maxConnections', async () => {
            const config = {
                listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
                minConnections: 100,
                maxConnections: 10,
            };
            await expect(createLibp2pNode(config)).rejects.toThrow(DHTError);
            await expect(createLibp2pNode(config)).rejects.toMatchObject({
                code: DHTErrorCode.INVALID_CONFIG,
            });
        });
        it('includes error context with the invalid config', async () => {
            const config = {
                listenAddresses: [],
            };
            try {
                await createLibp2pNode(config);
                expect.fail('Should have thrown');
            }
            catch (error) {
                expect(error).toBeInstanceOf(DHTError);
                const dhtError = error;
                expect(dhtError.context).toBeDefined();
                expect(dhtError.context?.config).toEqual(config);
            }
        });
    });
    describe('WebRTC configuration', () => {
        it('creates a node with WebRTC enabled', async () => {
            const config = {
                listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
                webrtc: { enabled: true },
            };
            const node = await createLibp2pNode(config);
            createdNodes.push(node);
            expect(node).toBeDefined();
        });
        it('creates a node with WebRTC and STUN servers', async () => {
            const config = {
                listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
                webrtc: {
                    enabled: true,
                    stunServers: ['stun:stun.l.google.com:19302'],
                },
            };
            const node = await createLibp2pNode(config);
            createdNodes.push(node);
            expect(node).toBeDefined();
        });
        it('creates a node using forBrowser() builder method', async () => {
            const config = DHTConfigBuilder.create()
                .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
                .forBrowser()
                .build();
            const node = await createLibp2pNode(config);
            createdNodes.push(node);
            expect(node).toBeDefined();
            expect(config.webrtc?.enabled).toBe(true);
            expect(config.circuitRelay?.enabled).toBe(true);
        });
        it('creates a node with WebRTC disabled (default)', async () => {
            const config = {
                listenAddresses: ['/ip4/127.0.0.1/tcp/0'],
                webrtc: { enabled: false },
            };
            const node = await createLibp2pNode(config);
            createdNodes.push(node);
            expect(node).toBeDefined();
        });
    });
});
//# sourceMappingURL=factory.test.js.map