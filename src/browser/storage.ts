/**
 * IndexedDB storage wrapper for browser nodes
 * 
 * Provides persistent storage for:
 * - Identity (peer ID and private key)
 * - Known peers
 * - DHT records
 * 
 * Falls back to in-memory storage in private browsing mode
 */

import type { StoredIdentity, StoredPeer, StoredDHTRecord } from './types.js';

const DB_NAME = 'libp2p-browser-node';
const DB_VERSION = 1;

const STORES = {
  IDENTITY: 'identity',
  PEERS: 'peers',
  DHT_RECORDS: 'dht-records',
} as const;

/**
 * In-memory fallback storage for private browsing mode
 */
class InMemoryStorage {
  private identity: StoredIdentity | null = null;
  private peers: Map<string, StoredPeer> = new Map();
  private dhtRecords: Map<string, StoredDHTRecord> = new Map();

  async getIdentity(): Promise<StoredIdentity | null> {
    return this.identity;
  }

  async setIdentity(identity: StoredIdentity): Promise<void> {
    this.identity = identity;
  }

  async clearIdentity(): Promise<void> {
    this.identity = null;
  }

  async getPeer(peerId: string): Promise<StoredPeer | null> {
    return this.peers.get(peerId) ?? null;
  }

  async setPeer(peer: StoredPeer): Promise<void> {
    this.peers.set(peer.peerId, peer);
  }

  async getAllPeers(): Promise<StoredPeer[]> {
    return Array.from(this.peers.values());
  }

  async deletePeer(peerId: string): Promise<void> {
    this.peers.delete(peerId);
  }

  async getDHTRecord(key: string): Promise<StoredDHTRecord | null> {
    return this.dhtRecords.get(key) ?? null;
  }

  async setDHTRecord(record: StoredDHTRecord): Promise<void> {
    this.dhtRecords.set(record.key, record);
  }

  async deleteDHTRecord(key: string): Promise<void> {
    this.dhtRecords.delete(key);
  }

  async pruneExpiredDHTRecords(): Promise<number> {
    const now = Date.now();
    let pruned = 0;
    for (const [key, record] of this.dhtRecords) {
      if (record.expiry < now) {
        this.dhtRecords.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  async clear(): Promise<void> {
    this.identity = null;
    this.peers.clear();
    this.dhtRecords.clear();
  }
}

/**
 * IndexedDB-backed storage for browser nodes
 */
export class BrowserStorage {
  private db: IDBDatabase | null = null;
  private fallback: InMemoryStorage | null = null;
  private initialized = false;

  /**
   * Initialize storage - must be called before other methods
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    if (!this.isIndexedDBAvailable()) {
      console.warn('IndexedDB not available, using in-memory storage');
      this.fallback = new InMemoryStorage();
      this.initialized = true;
      return;
    }

    try {
      this.db = await this.openDatabase();
      this.initialized = true;
    } catch (error) {
      console.warn('Failed to open IndexedDB, using in-memory storage:', error);
      this.fallback = new InMemoryStorage();
      this.initialized = true;
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
  }

  // Identity operations

  async getIdentity(): Promise<StoredIdentity | null> {
    if (this.fallback) return this.fallback.getIdentity();
    return this.get<StoredIdentity>(STORES.IDENTITY, 'primary');
  }

  async setIdentity(identity: StoredIdentity): Promise<void> {
    if (this.fallback) return this.fallback.setIdentity(identity);
    return this.put(STORES.IDENTITY, identity);
  }

  async clearIdentity(): Promise<void> {
    if (this.fallback) return this.fallback.clearIdentity();
    return this.delete(STORES.IDENTITY, 'primary');
  }

  // Peer operations

  async getPeer(peerId: string): Promise<StoredPeer | null> {
    if (this.fallback) return this.fallback.getPeer(peerId);
    return this.get<StoredPeer>(STORES.PEERS, peerId);
  }

  async setPeer(peer: StoredPeer): Promise<void> {
    if (this.fallback) return this.fallback.setPeer(peer);
    return this.put(STORES.PEERS, peer);
  }

  async getAllPeers(): Promise<StoredPeer[]> {
    if (this.fallback) return this.fallback.getAllPeers();
    return this.getAll<StoredPeer>(STORES.PEERS);
  }

  async deletePeer(peerId: string): Promise<void> {
    if (this.fallback) return this.fallback.deletePeer(peerId);
    return this.delete(STORES.PEERS, peerId);
  }

  // DHT record operations

  async getDHTRecord(key: string): Promise<StoredDHTRecord | null> {
    if (this.fallback) return this.fallback.getDHTRecord(key);
    return this.get<StoredDHTRecord>(STORES.DHT_RECORDS, key);
  }

  async setDHTRecord(record: StoredDHTRecord): Promise<void> {
    if (this.fallback) return this.fallback.setDHTRecord(record);
    return this.put(STORES.DHT_RECORDS, record);
  }

  async deleteDHTRecord(key: string): Promise<void> {
    if (this.fallback) return this.fallback.deleteDHTRecord(key);
    return this.delete(STORES.DHT_RECORDS, key);
  }

  async pruneExpiredDHTRecords(): Promise<number> {
    if (this.fallback) return this.fallback.pruneExpiredDHTRecords();
    
    const now = Date.now();
    const records = await this.getAll<StoredDHTRecord>(STORES.DHT_RECORDS);
    let pruned = 0;
    
    for (const record of records) {
      if (record.expiry < now) {
        await this.delete(STORES.DHT_RECORDS, record.key);
        pruned++;
      }
    }
    
    return pruned;
  }

  /**
   * Clear all stored data
   */
  async clear(): Promise<void> {
    if (this.fallback) return this.fallback.clear();
    
    await this.clearStore(STORES.IDENTITY);
    await this.clearStore(STORES.PEERS);
    await this.clearStore(STORES.DHT_RECORDS);
  }

  // Private helpers

  private isIndexedDBAvailable(): boolean {
    try {
      return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch {
      return false;
    }
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains(STORES.IDENTITY)) {
          db.createObjectStore(STORES.IDENTITY, { keyPath: 'id' });
        }
        
        if (!db.objectStoreNames.contains(STORES.PEERS)) {
          db.createObjectStore(STORES.PEERS, { keyPath: 'peerId' });
        }
        
        if (!db.objectStoreNames.contains(STORES.DHT_RECORDS)) {
          db.createObjectStore(STORES.DHT_RECORDS, { keyPath: 'key' });
        }
      };
    });
  }

  private get<T>(storeName: string, key: string): Promise<T | null> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      
      const transaction = this.db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result ?? null);
    });
  }

  private getAll<T>(storeName: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      
      const transaction = this.db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  private put(storeName: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      
      const transaction = this.db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(value);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  private delete(storeName: string, key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      
      const transaction = this.db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  private clearStore(storeName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      
      const transaction = this.db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}
