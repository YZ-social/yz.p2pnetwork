/**
 * Overlay Messaging Network Module
 * 
 * Provides request-response messaging between specific nodes with:
 * - Message deduplication to prevent flooding
 * - DHT-based routing for message delivery
 * - Hybrid post-quantum end-to-end encryption (X25519 + ML-KEM-768)
 */

// Error types
export { OverlayError, OverlayErrorCode } from './errors.js';

// Constants
export {
  MessageType,
  UnreachableReason,
  DEFAULT_OVERLAY_CONFIG,
  DEFAULT_ENCRYPTION_CONFIG,
  DEFAULT_ATTESTATION_CONFIG,
  OVERLAY_PROTOCOL_ID,
  PUBLIC_KEY_DHT_PREFIX,
  CRYPTO_CONSTANTS,
} from './constants.js';

// Types
export type {
  // Encryption types
  HybridPublicKey,
  HybridPrivateKey,
  HybridKeyPair,
  EncryptedPayload,
  
  // Message types
  RequestMessage,
  ResponseMessage,
  DuplicateMessage,
  UnreachableMessage,
  OverlayMessage,
  
  // Configuration types
  EncryptionConfig,
  AttestationConfig,
  OverlayConfig,
  SendOptions,
  MessageContext,
  MessageHandler,
  
  // Attestation types
  NodeAttestation,
  AttestationResult,
  AttestationVerifier,
  
  // Public key types
  PublicKeyRecord,
} from './types.js';

// Crypto
export { HybridCrypto, hybridCrypto } from './crypto.js';

// Key Management
export {
  KeyManager,
  PublicKeyCache,
  InMemoryKeyStorage,
  type KeyStorage,
} from './key-manager.js';

// Wire Protocol
export { WireProtocol, wireProtocol } from './wire-protocol.js';

// Deduplication Cache
export {
  DeduplicationCache,
  type DeduplicationEntry,
  type DeduplicationStats,
  type DeduplicationCacheConfig,
} from './dedup-cache.js';

// Pending Requests
export {
  PendingRequestsManager,
  type PendingRequest,
  type PendingRequestsConfig,
} from './pending-requests.js';

// Message Router
export {
  MessageRouter,
  type RouteResult,
  type MessageRouterConfig,
} from './router.js';

// Attestation
export {
  NoOpAttestationVerifier,
  TrustedHashAttestationVerifier,
  createAttestationVerifier,
} from './attestation.js';

// Overlay Network Facade
export { OverlayNetwork } from './overlay.js';
