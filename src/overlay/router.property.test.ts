/**
 * Property-based tests for MessageRouter
 *
 * Feature: overlay-messaging
 *
 * Tests the correctness properties of the MessageRouter class using
 * property-based testing with fast-check.
 *
 * Requirements: 4.2, 4.3
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { MessageRouter } from './router.js';
import { MessageType } from './constants.js';
import type { RequestMessage, HybridPublicKey, EncryptedPayload } from './types.js';

/**
 * Arbitrary for generating valid peer IDs
 */
const peerIdArbitrary = fc.string({ minLength: 10, maxLength: 52 }).filter(
  (s) => s.length > 0 && !s.includes('\0')
);

/**
 * Arbitrary for generating valid TTL values (1-255)
 */
const ttlArbitrary = fc.integer({ min: 1, max: 255 });

/**
 * Arbitrary for generating path arrays
 */
const pathArbitrary = fc.array(peerIdArbitrary, { minLength: 0, maxLength: 20 });

/**
 * Arbitrary for generating valid message IDs (UUID-like)
 */
const messageIdArbitrary = fc.uuid();

/**
 * Arbitrary for generating timestamps
 */
const timestampArbitrary = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });

/**
 * Create a mock DHT node for testing
 */
const createMockDHTNode = (localPeerId: string) => ({
  peerId: { toString: () => localPeerId },
  getClosestPeers: async function* () {
    // Empty generator - no peers
  },
});

/**
 * Create a valid HybridPublicKey for testing
 */
const createMockPublicKey = (): HybridPublicKey => ({
  x25519: new Uint8Array(32).fill(1),
  mlkem768: new Uint8Array(1184).fill(2),
});

/**
 * Create a valid EncryptedPayload for testing
 */
const createMockEncryptedPayload = (): EncryptedPayload => ({
  ephemeralX25519: new Uint8Array(32).fill(3),
  mlkemCiphertext: new Uint8Array(1088).fill(4),
  nonce: new Uint8Array(12).fill(5),
  ciphertext: new Uint8Array(100).fill(6),
  authTag: new Uint8Array(16).fill(7),
});

/**
 * Arbitrary for generating valid RequestMessage objects
 */
const requestMessageArbitrary = (localPeerId: string): fc.Arbitrary<RequestMessage> =>
  fc.record({
    type: fc.constant(MessageType.REQUEST as typeof MessageType.REQUEST),
    messageId: messageIdArbitrary,
    originPeerId: peerIdArbitrary,
    targetPeerId: peerIdArbitrary.filter((id) => id !== localPeerId),
    ttl: ttlArbitrary,
    timestamp: timestampArbitrary,
    path: pathArbitrary,
    originPublicKey: fc.constant(createMockPublicKey()),
    encryptedPayload: fc.constant(createMockEncryptedPayload()),
  });

describe('MessageRouter Property Tests', () => {
  /**
   * Feature: overlay-messaging, Property 6: TTL Decrement on Forward
   *
   * *For any* RequestMessage with TTL > 0 that is forwarded by a relay node,
   * the forwarded message has TTL equal to the original TTL minus 1.
   *
   * **Validates: Requirements 4.2**
   */
  describe('Property 6: TTL Decrement on Forward', () => {
    it('forwarded message TTL equals original TTL minus 1', async () => {
      const localPeerId = 'local-relay-peer-id';
      const mockDht = createMockDHTNode(localPeerId);
      const router = new MessageRouter(mockDht as any);

      await fc.assert(
        fc.property(requestMessageArbitrary(localPeerId), (message) => {
          const originalTtl = message.ttl;
          const prepared = router.prepareForForward(message);

          // Should be a REQUEST message (not UNREACHABLE) since TTL > 0
          expect(prepared.type).toBe(MessageType.REQUEST);

          const forwardedMessage = prepared as RequestMessage;
          expect(forwardedMessage.ttl).toBe(originalTtl - 1);
        }),
        { numRuns: 100 }
      );
    });

    it('TTL decrement is exactly 1 for any valid TTL', async () => {
      const localPeerId = 'local-relay-peer-id';
      const mockDht = createMockDHTNode(localPeerId);
      const router = new MessageRouter(mockDht as any);

      await fc.assert(
        fc.property(
          ttlArbitrary,
          peerIdArbitrary,
          peerIdArbitrary,
          pathArbitrary,
          (ttl, originPeerId, targetPeerId, path) => {
            const message: RequestMessage = {
              type: MessageType.REQUEST,
              messageId: 'test-id',
              originPeerId,
              targetPeerId,
              ttl,
              timestamp: Date.now(),
              path,
              originPublicKey: createMockPublicKey(),
              encryptedPayload: createMockEncryptedPayload(),
            };

            const prepared = router.prepareForForward(message);

            expect(prepared.type).toBe(MessageType.REQUEST);
            expect((prepared as RequestMessage).ttl).toBe(ttl - 1);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('multiple forwards decrement TTL cumulatively', async () => {
      const localPeerId = 'local-relay-peer-id';
      const mockDht = createMockDHTNode(localPeerId);
      const router = new MessageRouter(mockDht as any);

      await fc.assert(
        fc.property(
          fc.integer({ min: 3, max: 255 }), // Need at least 3 for multiple forwards
          peerIdArbitrary,
          peerIdArbitrary,
          (initialTtl, originPeerId, targetPeerId) => {
            let message: RequestMessage = {
              type: MessageType.REQUEST,
              messageId: 'test-id',
              originPeerId,
              targetPeerId,
              ttl: initialTtl,
              timestamp: Date.now(),
              path: [],
              originPublicKey: createMockPublicKey(),
              encryptedPayload: createMockEncryptedPayload(),
            };

            // Forward twice
            const prepared1 = router.prepareForForward(message);
            expect(prepared1.type).toBe(MessageType.REQUEST);
            message = prepared1 as RequestMessage;

            const prepared2 = router.prepareForForward(message);
            expect(prepared2.type).toBe(MessageType.REQUEST);
            const finalMessage = prepared2 as RequestMessage;

            // TTL should be decremented by 2
            expect(finalMessage.ttl).toBe(initialTtl - 2);
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  /**
   * Feature: overlay-messaging, Property 7: Path Tracking on Forward
   *
   * *For any* RequestMessage forwarded by a relay node, the forwarded
   * message's path array contains the relay node's peer ID appended
   * to the original path.
   *
   * **Validates: Requirements 4.3**
   */
  describe('Property 7: Path Tracking on Forward', () => {
    it('forwarded message path contains relay peer ID appended to original path', async () => {
      const localPeerId = 'local-relay-peer-id';
      const mockDht = createMockDHTNode(localPeerId);
      const router = new MessageRouter(mockDht as any);

      await fc.assert(
        fc.property(requestMessageArbitrary(localPeerId), (message) => {
          const originalPath = [...message.path];
          const prepared = router.prepareForForward(message);

          expect(prepared.type).toBe(MessageType.REQUEST);

          const forwardedMessage = prepared as RequestMessage;

          // Path should be original path + local peer ID
          expect(forwardedMessage.path).toEqual([...originalPath, localPeerId]);
        }),
        { numRuns: 100 }
      );
    });

    it('path length increases by exactly 1 after forwarding', async () => {
      const localPeerId = 'local-relay-peer-id';
      const mockDht = createMockDHTNode(localPeerId);
      const router = new MessageRouter(mockDht as any);

      await fc.assert(
        fc.property(requestMessageArbitrary(localPeerId), (message) => {
          const originalPathLength = message.path.length;
          const prepared = router.prepareForForward(message);

          expect(prepared.type).toBe(MessageType.REQUEST);

          const forwardedMessage = prepared as RequestMessage;
          expect(forwardedMessage.path.length).toBe(originalPathLength + 1);
        }),
        { numRuns: 100 }
      );
    });

    it('last element of forwarded path is always the relay peer ID', async () => {
      const localPeerId = 'local-relay-peer-id';
      const mockDht = createMockDHTNode(localPeerId);
      const router = new MessageRouter(mockDht as any);

      await fc.assert(
        fc.property(requestMessageArbitrary(localPeerId), (message) => {
          const prepared = router.prepareForForward(message);

          expect(prepared.type).toBe(MessageType.REQUEST);

          const forwardedMessage = prepared as RequestMessage;
          const lastElement = forwardedMessage.path[forwardedMessage.path.length - 1];
          expect(lastElement).toBe(localPeerId);
        }),
        { numRuns: 100 }
      );
    });

    it('original path elements are preserved in order', async () => {
      const localPeerId = 'local-relay-peer-id';
      const mockDht = createMockDHTNode(localPeerId);
      const router = new MessageRouter(mockDht as any);

      await fc.assert(
        fc.property(requestMessageArbitrary(localPeerId), (message) => {
          const originalPath = [...message.path];
          const prepared = router.prepareForForward(message);

          expect(prepared.type).toBe(MessageType.REQUEST);

          const forwardedMessage = prepared as RequestMessage;

          // All original path elements should be preserved in order
          for (let i = 0; i < originalPath.length; i++) {
            expect(forwardedMessage.path[i]).toBe(originalPath[i]);
          }
        }),
        { numRuns: 100 }
      );
    });

    it('multiple forwards build up path correctly', async () => {
      // Create multiple routers with different peer IDs
      const peerIds = ['relay-1', 'relay-2', 'relay-3'];
      const routers = peerIds.map((peerId) => {
        const mockDht = createMockDHTNode(peerId);
        return new MessageRouter(mockDht as any);
      });

      await fc.assert(
        fc.property(
          fc.integer({ min: 5, max: 255 }), // Need enough TTL for multiple forwards
          peerIdArbitrary,
          peerIdArbitrary,
          (ttl, originPeerId, targetPeerId) => {
            let message: RequestMessage = {
              type: MessageType.REQUEST,
              messageId: 'test-id',
              originPeerId,
              targetPeerId,
              ttl,
              timestamp: Date.now(),
              path: [],
              originPublicKey: createMockPublicKey(),
              encryptedPayload: createMockEncryptedPayload(),
            };

            // Forward through all routers
            for (const router of routers) {
              const prepared = router.prepareForForward(message);
              expect(prepared.type).toBe(MessageType.REQUEST);
              message = prepared as RequestMessage;
            }

            // Path should contain all relay peer IDs in order
            expect(message.path).toEqual(peerIds);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('original message path is not mutated', async () => {
      const localPeerId = 'local-relay-peer-id';
      const mockDht = createMockDHTNode(localPeerId);
      const router = new MessageRouter(mockDht as any);

      await fc.assert(
        fc.property(requestMessageArbitrary(localPeerId), (message) => {
          const originalPathCopy = [...message.path];

          router.prepareForForward(message);

          // Original message path should not be modified
          expect(message.path).toEqual(originalPathCopy);
        }),
        { numRuns: 100 }
      );
    });
  });
});
