/**
 * Type definitions for the Overlay Messaging Network
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4, 7.1-7.8
 */

import type { MessageType, UnreachableReason } from './constants.js';

// ============================================================================
// Encryption Types
// ============================================================================

/**
 * Hybrid public key combining classical and post-quantum cryptography
 */
export interface HybridPublicKey {
  /** X25519 public key (32 bytes) - classical ECDH */
  x25519: Uint8Array;
  /** ML-KEM-768 public key (1184 bytes) - post-quantum KEM */
  mlkem768: Uint8Array;
}

/**
 * Hybrid private key combining classical and post-quantum cryptography
 */
export interface HybridPrivateKey {
  /** X25519 private key (32 bytes) */
  x25519: Uint8Array;
  /** ML-KEM-768 private key (2400 bytes) */
  mlkem768: Uint8Array;
}

/**
 * Hybrid key pair for encryption/decryption
 */
export interface HybridKeyPair {
  publicKey: HybridPublicKey;
  privateKey: HybridPrivateKey;
}

/**
 * Encrypted payload structure
 */
export interface EncryptedPayload {
  /** Ephemeral X25519 public key (32 bytes) */
  ephemeralX25519: Uint8Array;
  /** ML-KEM encapsulation ciphertext (1088 bytes) */
  mlkemCiphertext: Uint8Array;
  /** AES-GCM nonce (12 bytes) */
  nonce: Uint8Array;
  /** Encrypted data (variable length) */
  ciphertext: Uint8Array;
  /** AES-GCM authentication tag (16 bytes) */
  authTag: Uint8Array;
}

// ============================================================================
// Message Types (Requirements 6.1, 6.2, 6.3, 6.4)
// ============================================================================

/**
 * Request message sent from origin to target
 * Requirement 6.1
 */
export interface RequestMessage {
  type: typeof MessageType.REQUEST;
  /** UUID v4 message identifier */
  messageId: string;
  /** Peer ID of the message originator */
  originPeerId: string;
  /** Peer ID of the intended recipient */
  targetPeerId: string;
  /** Time-to-live (hop count) */
  ttl: number;
  /** Unix timestamp when message was created */
  timestamp: number;
  /** List of peer IDs the message has traversed */
  path: string[];
  /** Origin's public keys for response encryption */
  originPublicKey: HybridPublicKey;
  /** Encrypted message payload */
  encryptedPayload: EncryptedPayload;
  /** Whether to request attestation from target */
  requestAttestation?: boolean;
}

/**
 * Response message sent from target back to origin
 * Requirement 6.2
 */
export interface ResponseMessage {
  type: typeof MessageType.RESPONSE;
  /** UUID v4 message identifier (matches request) */
  messageId: string;
  /** Peer ID of the original requester */
  originPeerId: string;
  /** Peer ID of the responder */
  targetPeerId: string;
  /** Response routing path */
  path: string[];
  /** Encrypted response payload */
  encryptedPayload: EncryptedPayload;
  /** Whether the handler succeeded */
  success: boolean;
  /** Error message if success is false (not encrypted) */
  errorMessage?: string;
  /** Optional attestation from target */
  attestation?: NodeAttestation;
}

/**
 * Duplicate notification message
 * Requirement 6.3
 */
export interface DuplicateMessage {
  type: typeof MessageType.DUPLICATE;
  /** UUID v4 message identifier */
  messageId: string;
}

/**
 * Unreachable notification message
 * Requirement 6.4
 */
export interface UnreachableMessage {
  type: typeof MessageType.UNREACHABLE;
  /** UUID v4 message identifier */
  messageId: string;
  /** Reason why target is unreachable */
  reason: UnreachableReason;
}

/**
 * Union type for all overlay messages
 */
export type OverlayMessage =
  | RequestMessage
  | ResponseMessage
  | DuplicateMessage
  | UnreachableMessage;

// ============================================================================
// Configuration Types (Requirements 7.1-7.8)
// ============================================================================

/**
 * Encryption configuration options
 * Requirement 7.8
 */
export interface EncryptionConfig {
  /** Whether encryption is enabled (default: true) */
  enabled?: boolean;
  /** Interval for publishing keys to DHT in ms (default: 1 hour) */
  keyPublishInterval?: number;
  /** TTL for cached public keys in ms (default: 5 minutes) */
  keyCacheTTL?: number;
}

/**
 * Attestation configuration options
 */
export interface AttestationConfig {
  /** Whether attestation is enabled (default: false) */
  enabled?: boolean;
  /** Custom attestation verifier */
  verifier?: AttestationVerifier;
  /** SHA-256 hash of handler code */
  handlerCodeHash?: string;
}

/**
 * Overlay network configuration
 * Requirements 7.1-7.8
 */
export interface OverlayConfig {
  /** Maximum message size in bytes (default: 64KB) - Requirement 7.2 */
  maxMessageSize?: number;
  /** Default TTL based on network size (default: 20) - Requirement 7.3 */
  defaultTTL?: number;
  /** Deduplication cache expiry in ms (default: 60000) - Requirement 7.4 */
  dedupeWindowMs?: number;
  /** Number of parallel paths (default: 3) - Requirement 7.5 */
  defaultRedundancy?: number;
  /** Request timeout in ms (default: 30000) - Requirement 7.6 */
  responseTimeout?: number;
  /** Encryption settings - Requirement 7.8 */
  encryption?: EncryptionConfig;
  /** Attestation settings */
  attestation?: AttestationConfig;
}

/**
 * Options for sending a message
 */
export interface SendOptions {
  /** Override default timeout */
  timeout?: number;
  /** Override default redundancy */
  redundancy?: number;
  /** Override default TTL */
  ttl?: number;
  /** Require target attestation (if enabled) */
  requireAttestation?: boolean;
}

/**
 * Context provided to message handlers
 */
export interface MessageContext {
  /** Peer ID of the message sender */
  originPeerId: string;
  /** Unique message identifier */
  messageId: string;
}

/**
 * Message handler function type
 */
export type MessageHandler = (
  payload: Uint8Array,
  context: MessageContext
) => Promise<Uint8Array> | Uint8Array;

// ============================================================================
// Attestation Types
// ============================================================================

/**
 * Node attestation data
 */
export interface NodeAttestation {
  /** Peer ID of the attesting node */
  peerId: string;
  /** SHA-256 hash of handler code */
  handlerCodeHash: string;
  /** Unix timestamp of attestation */
  timestamp: number;
  /** Signature by node's identity key */
  signature: Uint8Array;
  /** TEE type if using hardware attestation */
  teeType?: 'sgx' | 'nitro' | 'sev';
  /** TEE attestation data */
  teeAttestation?: Uint8Array;
}

/**
 * Result of attestation verification
 */
export interface AttestationResult {
  /** Whether attestation is valid */
  valid: boolean;
  /** Reason if invalid */
  reason?: string;
  /** Whether code hash is trusted */
  trustedCode?: boolean;
}

/**
 * Interface for attestation verification
 */
export interface AttestationVerifier {
  /** Verify a node's attestation */
  verify(attestation: NodeAttestation): Promise<AttestationResult>;
  /** Check if a code hash is trusted */
  isTrustedCodeHash(hash: string): boolean;
  /** Add a trusted code hash */
  addTrustedCodeHash(hash: string): void;
  /** Remove a trusted code hash */
  removeTrustedCodeHash(hash: string): void;
}

// ============================================================================
// Public Key Record Types
// ============================================================================

/**
 * Public key record stored in DHT
 */
export interface PublicKeyRecord {
  /** Peer ID of the key owner */
  peerId: string;
  /** X25519 public key (32 bytes) */
  x25519: Uint8Array;
  /** ML-KEM-768 public key (1184 bytes) */
  mlkem768: Uint8Array;
  /** Unix timestamp when published */
  timestamp: number;
  /** Signature by node's identity key */
  signature: Uint8Array;
}
