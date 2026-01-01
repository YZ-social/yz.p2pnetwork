/**
 * Constants for the Overlay Messaging Network
 * 
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */

/**
 * Message type identifiers for the wire protocol
 */
export enum MessageType {
  REQUEST = 0,
  RESPONSE = 1,
  DUPLICATE = 2,
  UNREACHABLE = 3,
}

/**
 * Reasons why a target is unreachable
 */
export enum UnreachableReason {
  TTL_EXPIRED = 0,
  TARGET_NOT_FOUND = 1,
  NO_ROUTE = 2,
  NO_HANDLER = 3,
  DECRYPTION_FAILED = 4,
  ATTESTATION_FAILED = 5,
}

/**
 * Default overlay configuration values
 * 
 * Requirement 7.7: Sensible defaults when overlay is not configured
 */
export const DEFAULT_OVERLAY_CONFIG = {
  /** Maximum message size in bytes (64KB) - Requirement 7.2 */
  maxMessageSize: 65536,
  
  /** Default TTL based on estimated network size - Requirement 7.3 */
  defaultTTL: 20,
  
  /** Deduplication cache expiry time in ms (1 minute) - Requirement 7.4 */
  dedupeWindowMs: 60000,
  
  /** Number of parallel paths for redundancy - Requirement 7.5 */
  defaultRedundancy: 3,
  
  /** Request timeout in ms (30 seconds) - Requirement 7.6 */
  responseTimeout: 30000,
} as const;

/**
 * Default encryption configuration values
 * 
 * Requirement 7.8: Hybrid post-quantum encryption as default
 */
export const DEFAULT_ENCRYPTION_CONFIG = {
  /** Whether encryption is enabled */
  enabled: true,
  
  /** Interval for publishing keys to DHT (1 hour) */
  keyPublishInterval: 3600000,
  
  /** TTL for cached public keys (5 minutes) */
  keyCacheTTL: 300000,
} as const;

/**
 * Default attestation configuration values
 */
export const DEFAULT_ATTESTATION_CONFIG = {
  /** Attestation is disabled by default */
  enabled: false,
} as const;

/**
 * Protocol identifier for libp2p
 */
export const OVERLAY_PROTOCOL_ID = '/overlay/1.0.0';

/**
 * DHT key prefix for public key storage
 */
export const PUBLIC_KEY_DHT_PREFIX = '/overlay/pubkey/';

/**
 * Crypto constants
 */
export const CRYPTO_CONSTANTS = {
  /** X25519 public key size in bytes */
  X25519_PUBLIC_KEY_SIZE: 32,
  
  /** X25519 private key size in bytes */
  X25519_PRIVATE_KEY_SIZE: 32,
  
  /** ML-KEM-768 public key size in bytes */
  MLKEM768_PUBLIC_KEY_SIZE: 1184,
  
  /** ML-KEM-768 private key size in bytes */
  MLKEM768_PRIVATE_KEY_SIZE: 2400,
  
  /** ML-KEM-768 ciphertext size in bytes */
  MLKEM768_CIPHERTEXT_SIZE: 1088,
  
  /** AES-256-GCM nonce size in bytes */
  AES_GCM_NONCE_SIZE: 12,
  
  /** AES-256-GCM auth tag size in bytes */
  AES_GCM_TAG_SIZE: 16,
  
  /** AES-256 key size in bytes */
  AES_KEY_SIZE: 32,
} as const;
