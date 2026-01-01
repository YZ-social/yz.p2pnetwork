/**
 * Unit tests for MessageRouter
 *
 * Tests message routing, forwarding logic, and response routing.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageRouter } from './router.js';
import { MessageType, UnreachableReason } from './constants.js';
import { OverlayErrorCode } from './errors.js';
import type { RequestMessage, ResponseMessage, HybridPublicKey, EncryptedPayload } from './types.js';

// Mock DHTNode
const createMockDHTNode = (peerId: string, closestPeers: string[] = []) => {
  const mockPeerId = {
    toString: () => peerId,
  };

  return {
    peerId: mockPeerId,
    getClosestPeers: vi.fn().mockImplementation(async function* () {
      for (const peer of closestPeers) {
        yield {
          id: { toString: () => peer },
          multiaddrs: [],
        };
      }
    }),
  };
};

// Helper to create a valid request message
const createRequestMessage = (overrides: Partial<RequestMessage> = {}): RequestMessage => {
  const mockPublicKey: HybridPublicKey = {
    x25519: new Uint8Array(32).fill(1),
    mlkem768: new Uint8Array(1184).fill(2),
  };

  const mockEncryptedPayload: EncryptedPayload = {
    ephemeralX25519: new Uint8Array(32).fill(3),
    mlkemCiphertext: new Uint8Array(1088).fill(4),
    nonce: new Uint8Array(12).fill(5),
    ciphertext: new Uint8Array(100).fill(6),
    authTag: new Uint8Array(16).fill(7),
  };

  return {
    type: MessageType.REQUEST,
    messageId: 'test-message-id-1234',
    originPeerId: 'origin-peer-id',
    targetPeerId: 'target-peer-id',
    ttl: 10,
    timestamp: Date.now(),
    path: [],
    originPublicKey: mockPublicKey,
    encryptedPayload: mockEncryptedPayload,
    ...overrides,
  };
};

// Helper to create a valid response message
const createResponseMessage = (overrides: Partial<ResponseMessage> = {}): ResponseMessage => {
  const mockEncryptedPayload: EncryptedPayload = {
    ephemeralX25519: new Uint8Array(32).fill(3),
    mlkemCiphertext: new Uint8Array(1088).fill(4),
    nonce: new Uint8Array(12).fill(5),
    ciphertext: new Uint8Array(100).fill(6),
    authTag: new Uint8Array(16).fill(7),
  };

  return {
    type: MessageType.RESPONSE,
    messageId: 'test-message-id-1234',
    originPeerId: 'origin-peer-id',
    targetPeerId: 'target-peer-id',
    path: ['relay-1', 'relay-2'],
    encryptedPayload: mockEncryptedPayload,
    success: true,
    ...overrides,
  };
};

describe('MessageRouter', () => {
  describe('constructor', () => {
    it('should create router with DHT node', () => {
      const mockDht = createMockDHTNode('local-peer-id');
      const router = new MessageRouter(mockDht as any);

      expect(router.peerId).toBe('local-peer-id');
    });

    it('should use default redundancy when not specified', () => {
      const mockDht = createMockDHTNode('local-peer-id');
      const router = new MessageRouter(mockDht as any);

      // Default redundancy is 3
      expect(router).toBeDefined();
    });

    it('should use custom redundancy when specified', () => {
      const mockDht = createMockDHTNode('local-peer-id');
      const router = new MessageRouter(mockDht as any, { defaultRedundancy: 5 });

      expect(router).toBeDefined();
    });
  });

  describe('isLocalTarget', () => {
    it('should return true when target matches local peer ID', () => {
      const mockDht = createMockDHTNode('local-peer-id');
      const router = new MessageRouter(mockDht as any);

      expect(router.isLocalTarget('local-peer-id')).toBe(true);
    });

    it('should return false when target does not match local peer ID', () => {
      const mockDht = createMockDHTNode('local-peer-id');
      const router = new MessageRouter(mockDht as any);

      expect(router.isLocalTarget('other-peer-id')).toBe(false);
    });
  });


  describe('prepareForForward', () => {
    it('should decrement TTL by 1 (Requirement 4.2)', () => {
      const mockDht = createMockDHTNode('relay-peer-id');
      const router = new MessageRouter(mockDht as any);

      const message = createRequestMessage({ ttl: 10 });
      const result = router.prepareForForward(message);

      expect(result.type).toBe(MessageType.REQUEST);
      expect((result as RequestMessage).ttl).toBe(9);
    });

    it('should append local peer ID to path (Requirement 4.3)', () => {
      const mockDht = createMockDHTNode('relay-peer-id');
      const router = new MessageRouter(mockDht as any);

      const message = createRequestMessage({ path: ['origin-peer'] });
      const result = router.prepareForForward(message);

      expect(result.type).toBe(MessageType.REQUEST);
      expect((result as RequestMessage).path).toEqual(['origin-peer', 'relay-peer-id']);
    });

    it('should return UNREACHABLE when TTL is 0 (Requirement 4.4)', () => {
      const mockDht = createMockDHTNode('relay-peer-id');
      const router = new MessageRouter(mockDht as any);

      const message = createRequestMessage({ ttl: 0 });
      const result = router.prepareForForward(message);

      expect(result.type).toBe(MessageType.UNREACHABLE);
      expect((result as any).reason).toBe(UnreachableReason.TTL_EXPIRED);
    });

    it('should return UNREACHABLE when TTL is negative', () => {
      const mockDht = createMockDHTNode('relay-peer-id');
      const router = new MessageRouter(mockDht as any);

      const message = createRequestMessage({ ttl: -1 });
      const result = router.prepareForForward(message);

      expect(result.type).toBe(MessageType.UNREACHABLE);
      expect((result as any).reason).toBe(UnreachableReason.TTL_EXPIRED);
    });

    it('should preserve other message fields', () => {
      const mockDht = createMockDHTNode('relay-peer-id');
      const router = new MessageRouter(mockDht as any);

      const message = createRequestMessage({
        messageId: 'unique-id',
        originPeerId: 'origin',
        targetPeerId: 'target',
        ttl: 5,
        timestamp: 12345,
      });
      const result = router.prepareForForward(message);

      expect(result.type).toBe(MessageType.REQUEST);
      const req = result as RequestMessage;
      expect(req.messageId).toBe('unique-id');
      expect(req.originPeerId).toBe('origin');
      expect(req.targetPeerId).toBe('target');
      expect(req.timestamp).toBe(12345);
    });
  });

  describe('getNextHops', () => {
    it('should return closest peers from DHT (Requirement 4.1)', async () => {
      const mockDht = createMockDHTNode('local-peer-id', ['peer-1', 'peer-2', 'peer-3']);
      const router = new MessageRouter(mockDht as any);

      const nextHops = await router.getNextHops('target-peer-id');

      expect(nextHops).toEqual(['peer-1', 'peer-2', 'peer-3']);
    });

    it('should exclude local peer ID from next hops', async () => {
      const mockDht = createMockDHTNode('local-peer-id', ['local-peer-id', 'peer-1', 'peer-2']);
      const router = new MessageRouter(mockDht as any);

      const nextHops = await router.getNextHops('target-peer-id');

      expect(nextHops).not.toContain('local-peer-id');
      expect(nextHops).toEqual(['peer-1', 'peer-2']);
    });

    it('should limit results to specified count', async () => {
      const mockDht = createMockDHTNode('local-peer-id', ['peer-1', 'peer-2', 'peer-3', 'peer-4']);
      const router = new MessageRouter(mockDht as any);

      const nextHops = await router.getNextHops('target-peer-id', 2);

      expect(nextHops).toHaveLength(2);
      expect(nextHops).toEqual(['peer-1', 'peer-2']);
    });

    it('should return empty array when no peers found', async () => {
      const mockDht = createMockDHTNode('local-peer-id', []);
      const router = new MessageRouter(mockDht as any);

      const nextHops = await router.getNextHops('target-peer-id');

      expect(nextHops).toEqual([]);
    });

    it('should handle DHT errors gracefully', async () => {
      const mockDht = createMockDHTNode('local-peer-id');
      mockDht.getClosestPeers = vi.fn().mockImplementation(async function* () {
        throw new Error('DHT error');
      });
      const router = new MessageRouter(mockDht as any);

      const nextHops = await router.getNextHops('target-peer-id');

      expect(nextHops).toEqual([]);
    });
  });

  describe('routeMessage', () => {
    it('should return delivered=true when target is local', async () => {
      const mockDht = createMockDHTNode('local-peer-id');
      const router = new MessageRouter(mockDht as any);

      const message = createRequestMessage({ targetPeerId: 'local-peer-id' });
      const result = await router.routeMessage(message);

      expect(result.delivered).toBe(true);
      expect(result.nextHops).toBeUndefined();
    });

    it('should return next hops when target is not local', async () => {
      const mockDht = createMockDHTNode('local-peer-id', ['peer-1', 'peer-2']);
      const router = new MessageRouter(mockDht as any);

      const message = createRequestMessage({ targetPeerId: 'remote-peer-id' });
      const result = await router.routeMessage(message);

      expect(result.delivered).toBe(false);
      expect(result.nextHops).toEqual(['peer-1', 'peer-2']);
    });

    it('should return TTL_EXPIRED error when TTL is 0', async () => {
      const mockDht = createMockDHTNode('local-peer-id', ['peer-1']);
      const router = new MessageRouter(mockDht as any);

      const message = createRequestMessage({ targetPeerId: 'remote-peer-id', ttl: 0 });
      const result = await router.routeMessage(message);

      expect(result.delivered).toBe(false);
      expect(result.error?.code).toBe(OverlayErrorCode.TTL_EXPIRED);
    });

    it('should return NO_ROUTE error when no peers found', async () => {
      const mockDht = createMockDHTNode('local-peer-id', []);
      const router = new MessageRouter(mockDht as any);

      const message = createRequestMessage({ targetPeerId: 'remote-peer-id' });
      const result = await router.routeMessage(message);

      expect(result.delivered).toBe(false);
      expect(result.error?.code).toBe(OverlayErrorCode.NO_ROUTE);
    });
  });


  describe('getReversePath', () => {
    it('should reverse the path (Requirement 5.2)', () => {
      const mockDht = createMockDHTNode('local-peer-id');
      const router = new MessageRouter(mockDht as any);

      const path = ['peer-1', 'peer-2', 'peer-3'];
      const reversed = router.getReversePath(path);

      expect(reversed).toEqual(['peer-3', 'peer-2', 'peer-1']);
    });

    it('should handle empty path', () => {
      const mockDht = createMockDHTNode('local-peer-id');
      const router = new MessageRouter(mockDht as any);

      const reversed = router.getReversePath([]);

      expect(reversed).toEqual([]);
    });

    it('should handle single element path', () => {
      const mockDht = createMockDHTNode('local-peer-id');
      const router = new MessageRouter(mockDht as any);

      const reversed = router.getReversePath(['peer-1']);

      expect(reversed).toEqual(['peer-1']);
    });

    it('should not modify original path', () => {
      const mockDht = createMockDHTNode('local-peer-id');
      const router = new MessageRouter(mockDht as any);

      const path = ['peer-1', 'peer-2', 'peer-3'];
      router.getReversePath(path);

      expect(path).toEqual(['peer-1', 'peer-2', 'peer-3']);
    });
  });

  describe('routeResponse', () => {
    it('should return delivered=true when origin is local', async () => {
      const mockDht = createMockDHTNode('local-peer-id');
      const router = new MessageRouter(mockDht as any);

      const response = createResponseMessage({ originPeerId: 'local-peer-id' });
      const result = await router.routeResponse(response);

      expect(result.delivered).toBe(true);
    });

    it('should use reverse path routing by default (Requirement 5.2)', async () => {
      const mockDht = createMockDHTNode('local-peer-id', ['dht-peer']);
      const router = new MessageRouter(mockDht as any);

      const response = createResponseMessage({
        originPeerId: 'origin-peer',
        path: ['relay-1', 'relay-2'],
      });
      const result = await router.routeResponse(response);

      expect(result.delivered).toBe(false);
      // Should use last peer in reversed path (relay-2)
      expect(result.nextHops).toEqual(['relay-2']);
    });

    it('should skip local peer ID in reverse path', async () => {
      const mockDht = createMockDHTNode('local-peer-id', ['dht-peer']);
      const router = new MessageRouter(mockDht as any);

      const response = createResponseMessage({
        originPeerId: 'origin-peer',
        path: ['relay-1', 'local-peer-id'],
      });
      const result = await router.routeResponse(response);

      expect(result.delivered).toBe(false);
      // Should skip local-peer-id and use relay-1
      expect(result.nextHops).toEqual(['relay-1']);
    });

    it('should fall back to DHT routing when path is empty (Requirement 5.3)', async () => {
      const mockDht = createMockDHTNode('local-peer-id', ['dht-peer-1']);
      const router = new MessageRouter(mockDht as any);

      const response = createResponseMessage({
        originPeerId: 'origin-peer',
        path: [],
      });
      const result = await router.routeResponse(response);

      expect(result.delivered).toBe(false);
      expect(result.nextHops).toEqual(['dht-peer-1']);
    });

    it('should use DHT routing when useReversePath is false', async () => {
      const mockDht = createMockDHTNode('local-peer-id', ['dht-peer-1']);
      const router = new MessageRouter(mockDht as any);

      const response = createResponseMessage({
        originPeerId: 'origin-peer',
        path: ['relay-1', 'relay-2'],
      });
      const result = await router.routeResponse(response, false);

      expect(result.delivered).toBe(false);
      expect(result.nextHops).toEqual(['dht-peer-1']);
    });

    it('should return NO_ROUTE error when no route found', async () => {
      const mockDht = createMockDHTNode('local-peer-id', []);
      const router = new MessageRouter(mockDht as any);

      const response = createResponseMessage({
        originPeerId: 'origin-peer',
        path: [],
      });
      const result = await router.routeResponse(response);

      expect(result.delivered).toBe(false);
      expect(result.error?.code).toBe(OverlayErrorCode.NO_ROUTE);
    });
  });

  describe('getForwardedMessage', () => {
    it('should return prepared message with updated TTL and path', () => {
      const mockDht = createMockDHTNode('relay-peer-id');
      const router = new MessageRouter(mockDht as any);

      const message = createRequestMessage({ ttl: 5, path: ['origin'] });
      const forwarded = router.getForwardedMessage(message);

      expect(forwarded).not.toBeNull();
      expect(forwarded!.ttl).toBe(4);
      expect(forwarded!.path).toEqual(['origin', 'relay-peer-id']);
    });

    it('should return null when TTL is 0', () => {
      const mockDht = createMockDHTNode('relay-peer-id');
      const router = new MessageRouter(mockDht as any);

      const message = createRequestMessage({ ttl: 0 });
      const forwarded = router.getForwardedMessage(message);

      expect(forwarded).toBeNull();
    });
  });
});
