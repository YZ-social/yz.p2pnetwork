/**
 * Unit tests for KeyManager
 *
 * Tests key pair initialization, storage, DHT publication, and caching.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  KeyManager,
  PublicKeyCache,
  InMemoryKeyStorage,
  type KeyStorage,
} from './key-manager.js';
import { HybridCrypto } from './crypto.js';
import { OverlayErrorCode } from './errors.js';
import type { HybridKeyPair, HybridPublicKey } from './types.js';

describe('KeyManager', () => {
  let keyManager: KeyManager;
  let storage: InMemoryKeyStorage;
  let crypto: HybridCrypto;

  beforeEach(() => {
    storage = new InMemoryKeyStorage();
    crypto = new HybridCrypto();
    keyManager = new KeyManager({ storage, crypto });
  });

  describe('initialize', () => {
    it('should generate new keys when no existing keys provided', async () => {
      await keyManager.initialize();

      const keyPair = keyManager.getKeyPair();
      expect(keyPair).toBeDefined();
      expect(keyPair.publicKey.x25519).toHaveLength(32);
      expect(keyPair.publicKey.mlkem768).toHaveLength(1184);
      expect(keyPair.privateKey.x25519).toHaveLength(32);
      expect(keyPair.privateKey.mlkem768).toHaveLength(2400);
    });

    it('should use provided existing keys', async () => {
      const existingKeys = await crypto.generateKeyPair();
      await keyManager.initialize(existingKeys);

      const keyPair = keyManager.getKeyPair();
      expect(keyPair.publicKey.x25519).toEqual(existingKeys.publicKey.x25519);
      expect(keyPair.publicKey.mlkem768).toEqual(existingKeys.publicKey.mlkem768);
    });

    it('should load keys from storage if available', async () => {
      // First initialize to generate and save keys
      await keyManager.initialize();
      const originalKeys = keyManager.getKeyPair();

      // Create new manager with same storage
      const newManager = new KeyManager({ storage, crypto });
      await newManager.initialize();

      const loadedKeys = newManager.getKeyPair();
      expect(loadedKeys.publicKey.x25519).toEqual(originalKeys.publicKey.x25519);
      expect(loadedKeys.publicKey.mlkem768).toEqual(originalKeys.publicKey.mlkem768);
    });

    it('should save generated keys to storage', async () => {
      await keyManager.initialize();
      const keyPair = keyManager.getKeyPair();

      const storedKeys = await storage.load();
      expect(storedKeys).toBeDefined();
      expect(storedKeys!.publicKey.x25519).toEqual(keyPair.publicKey.x25519);
    });
  });

  describe('getKeyPair', () => {
    it('should throw if not initialized', () => {
      expect(() => keyManager.getKeyPair()).toThrow();
      try {
        keyManager.getKeyPair();
      } catch (error: unknown) {
        expect((error as { code: string }).code).toBe(OverlayErrorCode.KEY_NOT_FOUND);
      }
    });
  });

  describe('getPublicKey', () => {
    it('should return public key after initialization', async () => {
      await keyManager.initialize();
      const publicKey = keyManager.getPublicKey();

      expect(publicKey.x25519).toHaveLength(32);
      expect(publicKey.mlkem768).toHaveLength(1184);
    });
  });

  describe('rotateKeys', () => {
    it('should generate new keys on rotation', async () => {
      await keyManager.initialize();
      const originalKeys = keyManager.getKeyPair();

      await keyManager.rotateKeys();
      const newKeys = keyManager.getKeyPair();

      // Keys should be different
      expect(newKeys.publicKey.x25519).not.toEqual(originalKeys.publicKey.x25519);
    });

    it('should save rotated keys to storage', async () => {
      await keyManager.initialize();
      await keyManager.rotateKeys();

      const newKeys = keyManager.getKeyPair();
      const storedKeys = await storage.load();

      expect(storedKeys!.publicKey.x25519).toEqual(newKeys.publicKey.x25519);
    });
  });
});

describe('PublicKeyCache', () => {
  let cache: PublicKeyCache;
  let mockPublicKey: HybridPublicKey;

  beforeEach(() => {
    cache = new PublicKeyCache(1000); // 1 second TTL
    mockPublicKey = {
      x25519: new Uint8Array(32).fill(1),
      mlkem768: new Uint8Array(1184).fill(2),
    };
  });

  describe('get/set', () => {
    it('should cache and retrieve public keys', () => {
      cache.set('peer1', mockPublicKey);
      const retrieved = cache.get('peer1');

      expect(retrieved).toBeDefined();
      expect(retrieved!.x25519).toEqual(mockPublicKey.x25519);
    });

    it('should return undefined for non-existent keys', () => {
      const result = cache.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should return undefined for expired keys', async () => {
      const shortTTLCache = new PublicKeyCache(50); // 50ms TTL
      shortTTLCache.set('peer1', mockPublicKey);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = shortTTLCache.get('peer1');
      expect(result).toBeUndefined();
    });
  });

  describe('invalidate', () => {
    it('should remove cached key', () => {
      cache.set('peer1', mockPublicKey);
      cache.invalidate('peer1');

      const result = cache.get('peer1');
      expect(result).toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      const shortTTLCache = new PublicKeyCache(50);
      shortTTLCache.set('peer1', mockPublicKey);
      shortTTLCache.set('peer2', mockPublicKey);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 100));

      shortTTLCache.cleanup();
      expect(shortTTLCache.size).toBe(0);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('peer1', mockPublicKey);
      cache.set('peer2', mockPublicKey);

      cache.clear();
      expect(cache.size).toBe(0);
    });
  });
});

describe('InMemoryKeyStorage', () => {
  let storage: InMemoryKeyStorage;
  let crypto: HybridCrypto;

  beforeEach(() => {
    storage = new InMemoryKeyStorage();
    crypto = new HybridCrypto();
  });

  it('should return undefined when no keys stored', async () => {
    const result = await storage.load();
    expect(result).toBeUndefined();
  });

  it('should save and load keys', async () => {
    const keyPair = await crypto.generateKeyPair();
    await storage.save(keyPair);

    const loaded = await storage.load();
    expect(loaded).toBeDefined();
    expect(loaded!.publicKey.x25519).toEqual(keyPair.publicKey.x25519);
  });

  it('should delete stored keys', async () => {
    const keyPair = await crypto.generateKeyPair();
    await storage.save(keyPair);
    await storage.delete();

    const result = await storage.load();
    expect(result).toBeUndefined();
  });
});
