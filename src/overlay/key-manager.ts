/**
 * Key Manager for Overlay Messaging Network
 *
 * Manages hybrid post-quantum key pairs (X25519 + ML-KEM-768):
 * - Key pair initialization (generate or load)
 * - Secure key storage interface
 * - DHT key publication and lookup
 * - Public key caching with TTL
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6
 */

import { sha256 } from '@noble/hashes/sha256';
import { HybridCrypto } from './crypto.js';
import { PUBLIC_KEY_DHT_PREFIX, DEFAULT_ENCRYPTION_CONFIG } from './constants.js';
import { OverlayError, OverlayErrorCode } from './errors.js';
import type {
  HybridPublicKey,
  HybridKeyPair,
  PublicKeyRecord,
} from './types.js';
import type { DHTNode } from '../dht/node.js';

/**
 * Interface for secure key storage
 * Implementations can provide persistent storage (file, database, etc.)
 */
export interface KeyStorage {
  /** Load stored key pair, returns undefined if not found */
  load(): Promise<HybridKeyPair | undefined>;
  /** Save key pair to storage */
  save(keyPair: HybridKeyPair): Promise<void>;
  /** Delete stored key pair */
  delete(): Promise<void>;
}

/**
 * In-memory key storage (non-persistent, for testing)
 */
export class InMemoryKeyStorage implements KeyStorage {
  private keyPair: HybridKeyPair | undefined;

  async load(): Promise<HybridKeyPair | undefined> {
    return this.keyPair;
  }

  async save(keyPair: HybridKeyPair): Promise<void> {
    this.keyPair = keyPair;
  }

  async delete(): Promise<void> {
    this.keyPair = undefined;
  }
}

/**
 * Cache entry for public keys
 */
interface PublicKeyCacheEntry {
  key: HybridPublicKey;
  timestamp: number;
}

/**
 * Public key cache with TTL-based expiration
 *
 * Requirement 10.4: Cache discovered public keys locally
 * Requirement 10.5: Refresh expired keys from DHT
 */
export class PublicKeyCache {
  private cache: Map<string, PublicKeyCacheEntry> = new Map();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_ENCRYPTION_CONFIG.keyCacheTTL) {
    this.ttlMs = ttlMs;
  }

  /**
   * Get cached key (returns undefined if not cached or expired)
   */
  get(peerId: string): HybridPublicKey | undefined {
    const entry = this.cache.get(peerId);
    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(peerId);
      return undefined;
    }

    return entry.key;
  }

  /**
   * Cache a key with TTL
   */
  set(peerId: string, key: HybridPublicKey): void {
    this.cache.set(peerId, {
      key,
      timestamp: Date.now(),
    });
  }

  /**
   * Invalidate a cached key
   */
  invalidate(peerId: string): void {
    this.cache.delete(peerId);
  }

  /**
   * Clean expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [peerId, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(peerId);
      }
    }
  }

  /**
   * Get cache size
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Clear all cached keys
   */
  clear(): void {
    this.cache.clear();
  }
}


/**
 * Key Manager for hybrid post-quantum encryption
 *
 * Requirements:
 * - 10.1: Generate or load hybrid key pair on node start
 * - 10.2: Store private keys securely
 * - 10.3: Publish public keys to DHT
 * - 10.4: Cache discovered public keys locally
 * - 10.5: Refresh expired keys from DHT
 * - 10.6: Support key rotation
 */
export class KeyManager {
  private keyPair: HybridKeyPair | undefined;
  private readonly crypto: HybridCrypto;
  private readonly storage: KeyStorage;
  private readonly publicKeyCache: PublicKeyCache;
  private dht: DHTNode | undefined;
  private peerId: string | undefined;

  constructor(options: {
    storage?: KeyStorage;
    cacheTTL?: number;
    crypto?: HybridCrypto;
  } = {}) {
    this.crypto = options.crypto ?? new HybridCrypto();
    this.storage = options.storage ?? new InMemoryKeyStorage();
    this.publicKeyCache = new PublicKeyCache(options.cacheTTL);
  }

  /**
   * Initialize with existing keys or generate new ones
   *
   * Requirement 10.1: Generate or load hybrid key pair on node start
   * Requirement 10.2: Store private keys securely
   *
   * @param existingKeys Optional existing key pair to use
   */
  async initialize(existingKeys?: HybridKeyPair): Promise<void> {
    if (existingKeys) {
      // Use provided keys
      this.keyPair = existingKeys;
      await this.storage.save(existingKeys);
      return;
    }

    // Try to load from storage
    const storedKeys = await this.storage.load();
    if (storedKeys) {
      this.keyPair = storedKeys;
      return;
    }

    // Generate new keys
    this.keyPair = await this.crypto.generateKeyPair();
    await this.storage.save(this.keyPair);
  }

  /**
   * Set the DHT node for key publication and lookup
   */
  setDHT(dht: DHTNode, peerId: string): void {
    this.dht = dht;
    this.peerId = peerId;
  }

  /**
   * Get this node's key pair
   * @throws OverlayError if not initialized
   */
  getKeyPair(): HybridKeyPair {
    if (!this.keyPair) {
      throw new OverlayError(
        OverlayErrorCode.KEY_NOT_FOUND,
        'KeyManager not initialized. Call initialize() first.'
      );
    }
    return this.keyPair;
  }

  /**
   * Get this node's public key
   * @throws OverlayError if not initialized
   */
  getPublicKey(): HybridPublicKey {
    return this.getKeyPair().publicKey;
  }

  /**
   * Get the public key cache for direct access
   */
  getCache(): PublicKeyCache {
    return this.publicKeyCache;
  }

  /**
   * Publish public key to DHT
   *
   * Requirement 10.3: Publish public keys to DHT for discovery
   *
   * @throws OverlayError if DHT not set or not initialized
   */
  async publishPublicKey(): Promise<void> {
    if (!this.dht || !this.peerId) {
      throw new OverlayError(
        OverlayErrorCode.KEY_NOT_FOUND,
        'DHT not set. Call setDHT() first.'
      );
    }

    if (!this.keyPair) {
      throw new OverlayError(
        OverlayErrorCode.KEY_NOT_FOUND,
        'KeyManager not initialized. Call initialize() first.'
      );
    }

    // Create the DHT key
    const dhtKey = this.getDHTKey(this.peerId);

    // Create the public key record
    const record = this.createPublicKeyRecord(this.peerId, this.keyPair.publicKey);

    // Serialize and store in DHT
    const serializedRecord = this.serializePublicKeyRecord(record);
    await this.dht.put(dhtKey, serializedRecord);
  }

  /**
   * Lookup a peer's public key from DHT or cache
   *
   * Requirement 10.4: Cache discovered public keys locally
   * Requirement 10.5: Refresh expired keys from DHT
   *
   * @param peerId The peer ID to lookup
   * @returns The peer's hybrid public key
   * @throws OverlayError if key not found
   */
  async lookupPublicKey(peerId: string): Promise<HybridPublicKey> {
    // Check cache first
    const cached = this.publicKeyCache.get(peerId);
    if (cached) {
      return cached;
    }

    // Lookup from DHT
    if (!this.dht) {
      throw new OverlayError(
        OverlayErrorCode.KEY_NOT_FOUND,
        'DHT not set. Call setDHT() first.'
      );
    }

    try {
      const dhtKey = this.getDHTKey(peerId);
      const data = await this.dht.get(dhtKey);
      const record = this.deserializePublicKeyRecord(data);

      // Validate the record
      if (record.peerId !== peerId) {
        throw new OverlayError(
          OverlayErrorCode.KEY_NOT_FOUND,
          `Public key record peer ID mismatch: expected ${peerId}, got ${record.peerId}`
        );
      }

      const publicKey: HybridPublicKey = {
        x25519: record.x25519,
        mlkem768: record.mlkem768,
      };

      // Cache the key
      this.publicKeyCache.set(peerId, publicKey);

      return publicKey;
    } catch (error) {
      if (error instanceof OverlayError) {
        throw error;
      }
      throw new OverlayError(
        OverlayErrorCode.KEY_NOT_FOUND,
        `Failed to lookup public key for peer ${peerId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }

  /**
   * Rotate keys - generate new keys and publish
   *
   * Requirement 10.6: Support key rotation
   */
  async rotateKeys(): Promise<void> {
    // Generate new keys
    const newKeyPair = await this.crypto.generateKeyPair();

    // Save to storage
    await this.storage.save(newKeyPair);

    // Update current keys
    this.keyPair = newKeyPair;

    // Publish new public key if DHT is available
    if (this.dht && this.peerId) {
      await this.publishPublicKey();
    }
  }

  /**
   * Get the DHT key for a peer's public key
   */
  private getDHTKey(peerId: string): Uint8Array {
    const keyString = `${PUBLIC_KEY_DHT_PREFIX}${peerId}`;
    return new TextEncoder().encode(keyString);
  }

  /**
   * Create a public key record for DHT storage
   */
  private createPublicKeyRecord(peerId: string, publicKey: HybridPublicKey): PublicKeyRecord {
    // Create a simple signature placeholder (in production, sign with identity key)
    const dataToSign = new Uint8Array([
      ...new TextEncoder().encode(peerId),
      ...publicKey.x25519,
      ...publicKey.mlkem768,
    ]);
    const signature = sha256(dataToSign);

    return {
      peerId,
      x25519: publicKey.x25519,
      mlkem768: publicKey.mlkem768,
      timestamp: Date.now(),
      signature,
    };
  }

  /**
   * Serialize a public key record for DHT storage
   */
  private serializePublicKeyRecord(record: PublicKeyRecord): Uint8Array {
    const peerIdBytes = new TextEncoder().encode(record.peerId);
    const peerIdLength = peerIdBytes.length;

    // Format: [peerIdLength (2 bytes)][peerId][x25519 (32)][mlkem768 (1184)][timestamp (8)][signature (32)]
    const totalSize = 2 + peerIdLength + 32 + 1184 + 8 + 32;
    const result = new Uint8Array(totalSize);
    let offset = 0;

    // Peer ID length (2 bytes, big-endian)
    result[offset++] = (peerIdLength >> 8) & 0xff;
    result[offset++] = peerIdLength & 0xff;

    // Peer ID
    result.set(peerIdBytes, offset);
    offset += peerIdLength;

    // X25519 public key
    result.set(record.x25519, offset);
    offset += 32;

    // ML-KEM-768 public key
    result.set(record.mlkem768, offset);
    offset += 1184;

    // Timestamp (8 bytes, big-endian)
    const timestamp = BigInt(record.timestamp);
    for (let i = 7; i >= 0; i--) {
      result[offset + i] = Number(timestamp & BigInt(0xff));
      // eslint-disable-next-line no-param-reassign
      record.timestamp = Number(BigInt(record.timestamp) >> BigInt(8));
    }
    // Restore timestamp and write correctly
    const ts = BigInt(Date.now());
    const view = new DataView(result.buffer, result.byteOffset + offset, 8);
    view.setBigUint64(0, ts, false);
    offset += 8;

    // Signature
    result.set(record.signature, offset);

    return result;
  }

  /**
   * Deserialize a public key record from DHT storage
   */
  private deserializePublicKeyRecord(data: Uint8Array): PublicKeyRecord {
    let offset = 0;

    // Peer ID length (2 bytes, big-endian)
    const peerIdLength = (data[offset] << 8) | data[offset + 1];
    offset += 2;

    // Peer ID
    const peerIdBytes = data.slice(offset, offset + peerIdLength);
    const peerId = new TextDecoder().decode(peerIdBytes);
    offset += peerIdLength;

    // X25519 public key
    const x25519 = data.slice(offset, offset + 32);
    offset += 32;

    // ML-KEM-768 public key
    const mlkem768 = data.slice(offset, offset + 1184);
    offset += 1184;

    // Timestamp (8 bytes, big-endian)
    const view = new DataView(data.buffer, data.byteOffset + offset, 8);
    const timestamp = Number(view.getBigUint64(0, false));
    offset += 8;

    // Signature
    const signature = data.slice(offset, offset + 32);

    return {
      peerId,
      x25519,
      mlkem768,
      timestamp,
      signature,
    };
  }
}
