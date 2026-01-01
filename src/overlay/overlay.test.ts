/**
 * Unit tests for OverlayNetwork class
 *
 * Tests the main facade for overlay messaging including:
 * - Configuration with defaults
 * - Lifecycle management (start/stop)
 * - Message handler registration
 *
 * Requirements: 7.1-7.8
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OverlayNetwork } from './overlay.js';
import { DEFAULT_OVERLAY_CONFIG, DEFAULT_ENCRYPTION_CONFIG, DEFAULT_ATTESTATION_CONFIG } from './constants.js';
import { OverlayError, OverlayErrorCode } from './errors.js';
import { NoOpAttestationVerifier, TrustedHashAttestationVerifier } from './attestation.js';
import type { DHTNode } from '../dht/node.js';
import type { AttestationVerifier } from './types.js';

// Mock DHTNode
function createMockDHTNode(): DHTNode {
  const mockPeerId = {
    toString: () => 'QmTestPeerId12345678901234567890123456789012345',
  };

  const mockLibp2p = {
    handle: vi.fn(),
    unhandle: vi.fn(),
    dialProtocol: vi.fn(),
    getMultiaddrs: vi.fn(() => []),
  };

  return {
    peerId: mockPeerId,
    isStarted: true,
    getLibp2pNode: () => mockLibp2p,
    put: vi.fn(),
    get: vi.fn(),
    getClosestPeers: vi.fn(async function* () {}),
  } as unknown as DHTNode;
}

describe('OverlayNetwork', () => {
  let mockDht: DHTNode;
  let overlay: OverlayNetwork;

  beforeEach(() => {
    mockDht = createMockDHTNode();
  });

  afterEach(async () => {
    if (overlay?.isStarted) {
      await overlay.stop();
    }
  });

  describe('constructor', () => {
    it('should create instance with default configuration', () => {
      overlay = new OverlayNetwork(mockDht);

      const config = overlay.getConfig();
      expect(config.maxMessageSize).toBe(DEFAULT_OVERLAY_CONFIG.maxMessageSize);
      expect(config.defaultTTL).toBe(DEFAULT_OVERLAY_CONFIG.defaultTTL);
      expect(config.dedupeWindowMs).toBe(DEFAULT_OVERLAY_CONFIG.dedupeWindowMs);
      expect(config.defaultRedundancy).toBe(DEFAULT_OVERLAY_CONFIG.defaultRedundancy);
      expect(config.responseTimeout).toBe(DEFAULT_OVERLAY_CONFIG.responseTimeout);
    });

    it('should create instance with custom configuration', () => {
      overlay = new OverlayNetwork(mockDht, {
        maxMessageSize: 32768,
        defaultTTL: 10,
        dedupeWindowMs: 30000,
        defaultRedundancy: 5,
        responseTimeout: 15000,
      });

      const config = overlay.getConfig();
      expect(config.maxMessageSize).toBe(32768);
      expect(config.defaultTTL).toBe(10);
      expect(config.dedupeWindowMs).toBe(30000);
      expect(config.defaultRedundancy).toBe(5);
      expect(config.responseTimeout).toBe(15000);
    });

    it('should apply encryption defaults', () => {
      overlay = new OverlayNetwork(mockDht);

      const config = overlay.getConfig();
      expect(config.encryption.enabled).toBe(DEFAULT_ENCRYPTION_CONFIG.enabled);
      expect(config.encryption.keyPublishInterval).toBe(DEFAULT_ENCRYPTION_CONFIG.keyPublishInterval);
      expect(config.encryption.keyCacheTTL).toBe(DEFAULT_ENCRYPTION_CONFIG.keyCacheTTL);
    });

    it('should apply custom encryption configuration', () => {
      overlay = new OverlayNetwork(mockDht, {
        encryption: {
          enabled: false,
          keyPublishInterval: 1800000,
          keyCacheTTL: 600000,
        },
      });

      const config = overlay.getConfig();
      expect(config.encryption.enabled).toBe(false);
      expect(config.encryption.keyPublishInterval).toBe(1800000);
      expect(config.encryption.keyCacheTTL).toBe(600000);
    });
  });


  describe('lifecycle', () => {
    it('should start and stop successfully', async () => {
      overlay = new OverlayNetwork(mockDht);

      expect(overlay.isStarted).toBe(false);

      await overlay.start();
      expect(overlay.isStarted).toBe(true);

      await overlay.stop();
      expect(overlay.isStarted).toBe(false);
    });

    it('should be idempotent for start', async () => {
      overlay = new OverlayNetwork(mockDht);

      await overlay.start();
      await overlay.start(); // Should not throw

      expect(overlay.isStarted).toBe(true);
    });

    it('should be idempotent for stop', async () => {
      overlay = new OverlayNetwork(mockDht);

      await overlay.start();
      await overlay.stop();
      await overlay.stop(); // Should not throw

      expect(overlay.isStarted).toBe(false);
    });

    it('should register protocol handler on start', async () => {
      overlay = new OverlayNetwork(mockDht);
      const libp2p = mockDht.getLibp2pNode();

      await overlay.start();

      expect(libp2p.handle).toHaveBeenCalledWith(
        '/overlay/1.0.0',
        expect.any(Function)
      );
    });

    it('should unregister protocol handler on stop', async () => {
      overlay = new OverlayNetwork(mockDht);
      const libp2p = mockDht.getLibp2pNode();

      await overlay.start();
      await overlay.stop();

      expect(libp2p.unhandle).toHaveBeenCalledWith('/overlay/1.0.0');
    });
  });

  describe('peerId', () => {
    it('should return the DHT peer ID', async () => {
      overlay = new OverlayNetwork(mockDht);
      await overlay.start();

      expect(overlay.peerId).toBe('QmTestPeerId12345678901234567890123456789012345');
    });
  });

  describe('dht', () => {
    it('should return the underlying DHT node', () => {
      overlay = new OverlayNetwork(mockDht);

      expect(overlay.dht).toBe(mockDht);
    });
  });

  describe('message handler', () => {
    it('should register message handler with onMessage', async () => {
      overlay = new OverlayNetwork(mockDht);
      await overlay.start();

      const handler = vi.fn();
      overlay.onMessage(handler);

      // Handler is registered internally - we can't directly test it
      // but we can verify it doesn't throw
      expect(() => overlay.onMessage(handler)).not.toThrow();
    });

    it('should remove message handler with offMessage', async () => {
      overlay = new OverlayNetwork(mockDht);
      await overlay.start();

      const handler = vi.fn();
      overlay.onMessage(handler);
      overlay.offMessage();

      // Handler is removed - we can't directly test it
      // but we can verify it doesn't throw
      expect(() => overlay.offMessage()).not.toThrow();
    });
  });

  describe('getPublicKeys', () => {
    it('should throw if not started', () => {
      overlay = new OverlayNetwork(mockDht);

      expect(() => overlay.getPublicKeys()).toThrow(OverlayError);
    });

    it('should return public keys after start', async () => {
      overlay = new OverlayNetwork(mockDht);
      await overlay.start();

      const keys = overlay.getPublicKeys();
      expect(keys).toBeDefined();
      expect(keys.x25519).toBeInstanceOf(Uint8Array);
      expect(keys.mlkem768).toBeInstanceOf(Uint8Array);
      expect(keys.x25519.length).toBe(32);
      expect(keys.mlkem768.length).toBe(1184);
    });
  });

  describe('sendMessage validation', () => {
    it('should throw if not started', async () => {
      overlay = new OverlayNetwork(mockDht);

      await expect(
        overlay.sendMessage('targetPeer', new Uint8Array([1, 2, 3]))
      ).rejects.toThrow(OverlayError);
    });

    it('should throw MESSAGE_TOO_LARGE for oversized payload', async () => {
      overlay = new OverlayNetwork(mockDht, { maxMessageSize: 100 });
      await overlay.start();

      const largePayload = new Uint8Array(200);

      await expect(
        overlay.sendMessage('targetPeer', largePayload)
      ).rejects.toMatchObject({
        code: OverlayErrorCode.MESSAGE_TOO_LARGE,
      });
    });
  });

  describe('attestation configuration', () => {
    it('should apply default attestation config (disabled)', () => {
      overlay = new OverlayNetwork(mockDht);

      const config = overlay.getConfig();
      expect(config.attestation.enabled).toBe(DEFAULT_ATTESTATION_CONFIG.enabled);
      expect(config.attestation.enabled).toBe(false);
    });

    it('should apply custom attestation config', () => {
      overlay = new OverlayNetwork(mockDht, {
        attestation: {
          enabled: true,
          handlerCodeHash: 'test-hash-123',
        },
      });

      const config = overlay.getConfig();
      expect(config.attestation.enabled).toBe(true);
      expect(config.attestation.handlerCodeHash).toBe('test-hash-123');
    });

    it('should return false for isAttestationEnabled when disabled', () => {
      overlay = new OverlayNetwork(mockDht);
      expect(overlay.isAttestationEnabled()).toBe(false);
    });

    it('should return true for isAttestationEnabled when enabled', () => {
      overlay = new OverlayNetwork(mockDht, {
        attestation: { enabled: true },
      });
      expect(overlay.isAttestationEnabled()).toBe(true);
    });

    it('should return NoOpAttestationVerifier by default', () => {
      overlay = new OverlayNetwork(mockDht);
      const verifier = overlay.getAttestationVerifier();
      expect(verifier).toBeInstanceOf(NoOpAttestationVerifier);
    });

    it('should allow setting custom attestation verifier', () => {
      overlay = new OverlayNetwork(mockDht);
      const customVerifier = new TrustedHashAttestationVerifier({
        trustedHashes: ['hash1'],
      });

      overlay.setAttestationVerifier(customVerifier);
      const verifier = overlay.getAttestationVerifier();
      expect(verifier).toBe(customVerifier);
    });

    it('should return undefined for getHandlerCodeHash when not set', () => {
      overlay = new OverlayNetwork(mockDht);
      expect(overlay.getHandlerCodeHash()).toBeUndefined();
    });

    it('should return handler code hash when set in config', () => {
      overlay = new OverlayNetwork(mockDht, {
        attestation: {
          handlerCodeHash: 'my-code-hash',
        },
      });
      expect(overlay.getHandlerCodeHash()).toBe('my-code-hash');
    });

    it('should allow setting handler code hash', () => {
      overlay = new OverlayNetwork(mockDht);
      overlay.setHandlerCodeHash('new-hash');
      expect(overlay.getHandlerCodeHash()).toBe('new-hash');
    });

    it('should use verifier from config if provided', () => {
      const customVerifier: AttestationVerifier = {
        verify: vi.fn().mockResolvedValue({ valid: true }),
        isTrustedCodeHash: vi.fn().mockReturnValue(true),
        addTrustedCodeHash: vi.fn(),
        removeTrustedCodeHash: vi.fn(),
      };

      overlay = new OverlayNetwork(mockDht, {
        attestation: {
          enabled: true,
          verifier: customVerifier,
        },
      });

      const verifier = overlay.getAttestationVerifier();
      expect(verifier).toBe(customVerifier);
    });
  });
});
