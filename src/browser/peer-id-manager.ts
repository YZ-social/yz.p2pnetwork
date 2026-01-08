/**
 * Peer ID Manager - handles peer ID generation and persistence
 * 
 * Supports two modes:
 * - persistent: Store peer ID in IndexedDB, reuse across sessions
 * - ephemeral: Generate new peer ID for each tab/session
 */

import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys';
import { peerIdFromPrivateKey } from '@libp2p/peer-id';
import type { PeerId, PrivateKey } from '@libp2p/interface';
import type { PeerIdManagerConfig, StoredIdentity } from './types.js';

const DB_NAME = 'libp2p-browser-node';
const DB_VERSION = 1;
const IDENTITY_STORE = 'identity';

/**
 * Opens the IndexedDB database for peer ID storage
 */
async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDENTITY_STORE)) {
        db.createObjectStore(IDENTITY_STORE, { keyPath: 'id' });
      }
    };
  });
}

/**
 * Manages peer ID generation and persistence for browser nodes
 */
export class PeerIdManager {
  private config: PeerIdManagerConfig;
  private cachedPeerId: PeerId | null = null;
  private cachedPrivateKey: PrivateKey | null = null;

  constructor(config: PeerIdManagerConfig) {
    this.config = config;
  }

  /**
   * Get or generate a peer ID based on the configured mode
   */
  async getPeerId(): Promise<PeerId> {
    if (this.cachedPeerId) {
      return this.cachedPeerId;
    }

    if (this.config.mode === 'ephemeral') {
      return this.generateNewPeerId();
    }

    // Persistent mode - try to load from storage
    try {
      const stored = await this.loadFromStorage();
      if (stored) {
        this.cachedPeerId = stored.peerId;
        this.cachedPrivateKey = stored.privateKey;
        return stored.peerId;
      }
    } catch (error) {
      console.warn('Failed to load peer ID from storage, generating new one:', error);
    }

    // Generate new and save
    const peerId = await this.generateNewPeerId();
    await this.saveToStorage();
    return peerId;
  }

  /**
   * Get the private key (must call getPeerId first)
   */
  getPrivateKey(): PrivateKey | null {
    return this.cachedPrivateKey;
  }

  /**
   * Generate a new Ed25519 peer ID
   */
  private async generateNewPeerId(): Promise<PeerId> {
    const privateKey = await generateKeyPair('Ed25519');
    const peerId = peerIdFromPrivateKey(privateKey);
    
    this.cachedPrivateKey = privateKey;
    this.cachedPeerId = peerId;
    
    return peerId;
  }

  /**
   * Load peer ID from IndexedDB storage
   */
  private async loadFromStorage(): Promise<{ peerId: PeerId; privateKey: PrivateKey } | null> {
    if (!this.isIndexedDBAvailable()) {
      return null;
    }

    const db = await openDatabase();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(IDENTITY_STORE, 'readonly');
      const store = transaction.objectStore(IDENTITY_STORE);
      const request = store.get(this.config.storageKey);
      
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
      
      request.onsuccess = async () => {
        db.close();
        const stored = request.result as StoredIdentity | undefined;
        
        if (!stored) {
          resolve(null);
          return;
        }

        try {
          // Reconstruct private key from stored bytes
          const privateKey = privateKeyFromProtobuf(stored.privateKey);
          const peerId = peerIdFromPrivateKey(privateKey);
          resolve({ peerId, privateKey });
        } catch (error) {
          console.warn('Failed to unmarshal stored private key:', error);
          resolve(null);
        }
      };
    });
  }

  /**
   * Save current peer ID to IndexedDB storage
   */
  private async saveToStorage(): Promise<void> {
    if (!this.isIndexedDBAvailable() || !this.cachedPrivateKey || !this.cachedPeerId) {
      return;
    }

    const db = await openDatabase();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(IDENTITY_STORE, 'readwrite');
      const store = transaction.objectStore(IDENTITY_STORE);
      
      const privateKeyBytes = privateKeyToProtobuf(this.cachedPrivateKey!);
      
      const identity: StoredIdentity = {
        id: 'primary',
        privateKey: privateKeyBytes,
        peerId: this.cachedPeerId!.toString(),
        createdAt: Date.now(),
      };
      
      const request = store.put(identity);
      
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
      
      request.onsuccess = () => {
        db.close();
        resolve();
      };
    });
  }

  /**
   * Clear stored peer ID (useful for testing or reset)
   */
  async clearStoredPeerId(): Promise<void> {
    this.cachedPeerId = null;
    this.cachedPrivateKey = null;

    if (!this.isIndexedDBAvailable()) {
      return;
    }

    const db = await openDatabase();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(IDENTITY_STORE, 'readwrite');
      const store = transaction.objectStore(IDENTITY_STORE);
      const request = store.delete(this.config.storageKey);
      
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
      
      request.onsuccess = () => {
        db.close();
        resolve();
      };
    });
  }

  /**
   * Check if IndexedDB is available (not in private browsing mode)
   */
  private isIndexedDBAvailable(): boolean {
    try {
      return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch {
      return false;
    }
  }
}
