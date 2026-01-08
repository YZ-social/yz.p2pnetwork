/**
 * Security Module for Browser Node
 * 
 * Implements message validation and rate limiting for browser-native libp2p nodes.
 * 
 * Requirements: 9.1, 9.2, 9.5, 3.5
 */

import { MessageType, CRYPTO_CONSTANTS, DEFAULT_OVERLAY_CONFIG } from '../overlay/constants.js';
import { OverlayError, OverlayErrorCode } from '../overlay/errors.js';
import type { OverlayMessage, RequestMessage, ResponseMessage } from '../overlay/types.js';

// ============================================================================
// Message Validation Types
// ============================================================================

/**
 * Result of message validation
 */
export interface ValidationResult {
  /** Whether the message is valid */
  valid: boolean;
  /** Error code if invalid */
  errorCode?: OverlayErrorCode;
  /** Human-readable error message */
  errorMessage?: string;
}

/**
 * Configuration for message validation
 */
export interface MessageValidationConfig {
  /** Maximum message size in bytes (default: 64KB) */
  maxMessageSize: number;
  /** Maximum TTL value (default: 255) */
  maxTTL: number;
  /** Maximum path length (default: 50) */
  maxPathLength: number;
  /** Maximum peer ID length (default: 128) */
  maxPeerIdLength: number;
  /** Maximum timestamp drift in ms (default: 5 minutes) */
  maxTimestampDrift: number;
}

/**
 * Default message validation configuration
 */
export const DEFAULT_MESSAGE_VALIDATION_CONFIG: MessageValidationConfig = {
  maxMessageSize: DEFAULT_OVERLAY_CONFIG.maxMessageSize,
  maxTTL: 255,
  maxPathLength: 50,
  maxPeerIdLength: 128,
  maxTimestampDrift: 5 * 60 * 1000, // 5 minutes
};

// ============================================================================
// Rate Limiting Types
// ============================================================================

/**
 * Configuration for rate limiting
 */
export interface RateLimitConfig {
  /** Maximum connections per second from a single IP/peer */
  maxConnectionsPerSecond: number;
  /** Maximum messages per second from a single peer */
  maxMessagesPerSecond: number;
  /** Maximum relay requests per minute */
  maxRelayRequestsPerMinute: number;
  /** Window size for rate limiting in ms */
  windowSizeMs: number;
  /** Cleanup interval for expired entries in ms */
  cleanupIntervalMs: number;
}

/**
 * Default rate limit configuration
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxConnectionsPerSecond: 10,
  maxMessagesPerSecond: 100,
  maxRelayRequestsPerMinute: 30,
  windowSizeMs: 1000,
  cleanupIntervalMs: 60000,
};

/**
 * Rate limit entry for tracking requests
 */
interface RateLimitEntry {
  /** Timestamps of recent requests */
  timestamps: number[];
  /** Whether currently blocked */
  blocked: boolean;
  /** Block expiry time */
  blockExpiry?: number;
}

// ============================================================================
// Message Validator
// ============================================================================

/**
 * Validates incoming overlay messages against protocol specifications.
 * 
 * Requirements: 9.1, 9.5
 */
export class MessageValidator {
  private readonly config: MessageValidationConfig;

  constructor(config: Partial<MessageValidationConfig> = {}) {
    this.config = { ...DEFAULT_MESSAGE_VALIDATION_CONFIG, ...config };
  }

  /**
   * Validate a raw message buffer before decoding
   * 
   * @param data - Raw message bytes
   * @returns Validation result
   */
  validateRawMessage(data: Uint8Array): ValidationResult {
    // Check message size
    if (data.length === 0) {
      return {
        valid: false,
        errorCode: OverlayErrorCode.INVALID_MESSAGE,
        errorMessage: 'Empty message',
      };
    }

    if (data.length > this.config.maxMessageSize) {
      return {
        valid: false,
        errorCode: OverlayErrorCode.MESSAGE_TOO_LARGE,
        errorMessage: `Message size ${data.length} exceeds maximum ${this.config.maxMessageSize}`,
      };
    }

    // Check header byte is valid
    const header = data[0];
    const messageType = header & 0x03;
    
    if (messageType > MessageType.UNREACHABLE) {
      return {
        valid: false,
        errorCode: OverlayErrorCode.INVALID_MESSAGE,
        errorMessage: `Invalid message type: ${messageType}`,
      };
    }

    return { valid: true };
  }

  /**
   * Validate a decoded overlay message
   * 
   * @param message - Decoded overlay message
   * @returns Validation result
   */
  validateMessage(message: OverlayMessage): ValidationResult {
    switch (message.type) {
      case MessageType.REQUEST:
        return this.validateRequestMessage(message as RequestMessage);
      case MessageType.RESPONSE:
        return this.validateResponseMessage(message as ResponseMessage);
      case MessageType.DUPLICATE:
      case MessageType.UNREACHABLE:
        return this.validateSimpleMessage(message);
      default:
        return {
          valid: false,
          errorCode: OverlayErrorCode.INVALID_MESSAGE,
          errorMessage: `Unknown message type: ${(message as OverlayMessage).type}`,
        };
    }
  }

  /**
   * Validate a REQUEST message
   */
  private validateRequestMessage(message: RequestMessage): ValidationResult {
    // Validate message ID (UUID format)
    if (!this.isValidUUID(message.messageId)) {
      return {
        valid: false,
        errorCode: OverlayErrorCode.INVALID_MESSAGE,
        errorMessage: 'Invalid message ID format',
      };
    }

    // Validate peer IDs
    const originResult = this.validatePeerId(message.originPeerId, 'origin');
    if (!originResult.valid) return originResult;

    const targetResult = this.validatePeerId(message.targetPeerId, 'target');
    if (!targetResult.valid) return targetResult;

    // Validate TTL
    if (message.ttl < 0 || message.ttl > this.config.maxTTL) {
      return {
        valid: false,
        errorCode: OverlayErrorCode.INVALID_MESSAGE,
        errorMessage: `Invalid TTL: ${message.ttl}`,
      };
    }

    // Validate timestamp
    const timestampResult = this.validateTimestamp(message.timestamp);
    if (!timestampResult.valid) return timestampResult;

    // Validate path
    const pathResult = this.validatePath(message.path);
    if (!pathResult.valid) return pathResult;

    // Validate public key sizes
    const keyResult = this.validateHybridPublicKey(message.originPublicKey);
    if (!keyResult.valid) return keyResult;

    // Validate encrypted payload
    const payloadResult = this.validateEncryptedPayload(message.encryptedPayload);
    if (!payloadResult.valid) return payloadResult;

    return { valid: true };
  }

  /**
   * Validate a RESPONSE message
   */
  private validateResponseMessage(message: ResponseMessage): ValidationResult {
    // Validate message ID
    if (!this.isValidUUID(message.messageId)) {
      return {
        valid: false,
        errorCode: OverlayErrorCode.INVALID_MESSAGE,
        errorMessage: 'Invalid message ID format',
      };
    }

    // Validate peer IDs
    const originResult = this.validatePeerId(message.originPeerId, 'origin');
    if (!originResult.valid) return originResult;

    const targetResult = this.validatePeerId(message.targetPeerId, 'target');
    if (!targetResult.valid) return targetResult;

    // Validate path
    const pathResult = this.validatePath(message.path);
    if (!pathResult.valid) return pathResult;

    // Validate encrypted payload
    const payloadResult = this.validateEncryptedPayload(message.encryptedPayload);
    if (!payloadResult.valid) return payloadResult;

    return { valid: true };
  }

  /**
   * Validate simple messages (DUPLICATE, UNREACHABLE)
   */
  private validateSimpleMessage(message: OverlayMessage): ValidationResult {
    if (!this.isValidUUID(message.messageId)) {
      return {
        valid: false,
        errorCode: OverlayErrorCode.INVALID_MESSAGE,
        errorMessage: 'Invalid message ID format',
      };
    }

    return { valid: true };
  }

  /**
   * Validate a peer ID
   */
  private validatePeerId(peerId: string, field: string): ValidationResult {
    if (!peerId || peerId.length === 0) {
      return {
        valid: false,
        errorCode: OverlayErrorCode.INVALID_MESSAGE,
        errorMessage: `Empty ${field} peer ID`,
      };
    }

    if (peerId.length > this.config.maxPeerIdLength) {
      return {
        valid: false,
        errorCode: OverlayErrorCode.INVALID_MESSAGE,
        errorMessage: `${field} peer ID too long: ${peerId.length}`,
      };
    }

    // Basic format check - peer IDs should be base58 or similar
    if (!/^[a-zA-Z0-9]+$/.test(peerId)) {
      return {
        valid: false,
        errorCode: OverlayErrorCode.INVALID_MESSAGE,
        errorMessage: `Invalid ${field} peer ID format`,
      };
    }

    return { valid: true };
  }

  /**
   * Validate a timestamp
   */
  private validateTimestamp(timestamp: number): ValidationResult {
    const now = Date.now();
    const drift = Math.abs(now - timestamp);

    if (drift > this.config.maxTimestampDrift) {
      return {
        valid: false,
        errorCode: OverlayErrorCode.INVALID_MESSAGE,
        errorMessage: `Timestamp drift too large: ${drift}ms`,
      };
    }

    return { valid: true };
  }

  /**
   * Validate a message path
   */
  private validatePath(path: string[]): ValidationResult {
    if (path.length > this.config.maxPathLength) {
      return {
        valid: false,
        errorCode: OverlayErrorCode.INVALID_MESSAGE,
        errorMessage: `Path too long: ${path.length}`,
      };
    }

    // Validate each peer ID in path
    for (let i = 0; i < path.length; i++) {
      const result = this.validatePeerId(path[i], `path[${i}]`);
      if (!result.valid) return result;
    }

    // Check for duplicate entries (loop detection)
    const seen = new Set<string>();
    for (const peerId of path) {
      if (seen.has(peerId)) {
        return {
          valid: false,
          errorCode: OverlayErrorCode.INVALID_MESSAGE,
          errorMessage: 'Duplicate peer ID in path (routing loop detected)',
        };
      }
      seen.add(peerId);
    }

    return { valid: true };
  }

  /**
   * Validate hybrid public key sizes
   */
  private validateHybridPublicKey(key: { x25519: Uint8Array; mlkem768: Uint8Array }): ValidationResult {
    if (key.x25519.length !== CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE) {
      return {
        valid: false,
        errorCode: OverlayErrorCode.INVALID_MESSAGE,
        errorMessage: `Invalid X25519 key size: ${key.x25519.length}`,
      };
    }

    if (key.mlkem768.length !== CRYPTO_CONSTANTS.MLKEM768_PUBLIC_KEY_SIZE) {
      return {
        valid: false,
        errorCode: OverlayErrorCode.INVALID_MESSAGE,
        errorMessage: `Invalid ML-KEM key size: ${key.mlkem768.length}`,
      };
    }

    return { valid: true };
  }

  /**
   * Validate encrypted payload structure
   */
  private validateEncryptedPayload(payload: {
    ephemeralX25519: Uint8Array;
    mlkemCiphertext: Uint8Array;
    nonce: Uint8Array;
    ciphertext: Uint8Array;
    authTag: Uint8Array;
  }): ValidationResult {
    if (payload.ephemeralX25519.length !== CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE) {
      return {
        valid: false,
        errorCode: OverlayErrorCode.INVALID_MESSAGE,
        errorMessage: `Invalid ephemeral X25519 size: ${payload.ephemeralX25519.length}`,
      };
    }

    if (payload.mlkemCiphertext.length !== CRYPTO_CONSTANTS.MLKEM768_CIPHERTEXT_SIZE) {
      return {
        valid: false,
        errorCode: OverlayErrorCode.INVALID_MESSAGE,
        errorMessage: `Invalid ML-KEM ciphertext size: ${payload.mlkemCiphertext.length}`,
      };
    }

    if (payload.nonce.length !== CRYPTO_CONSTANTS.AES_GCM_NONCE_SIZE) {
      return {
        valid: false,
        errorCode: OverlayErrorCode.INVALID_MESSAGE,
        errorMessage: `Invalid nonce size: ${payload.nonce.length}`,
      };
    }

    if (payload.authTag.length !== CRYPTO_CONSTANTS.AES_GCM_TAG_SIZE) {
      return {
        valid: false,
        errorCode: OverlayErrorCode.INVALID_MESSAGE,
        errorMessage: `Invalid auth tag size: ${payload.authTag.length}`,
      };
    }

    return { valid: true };
  }

  /**
   * Check if a string is a valid UUID (any version)
   */
  private isValidUUID(uuid: string): boolean {
    // Accept any valid UUID format (v1-v5 and variants)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }
}


// ============================================================================
// Rate Limiter
// ============================================================================

/**
 * Rate limiter for incoming connections and messages.
 * 
 * Requirements: 9.2, 3.5
 */
export class RateLimiter {
  private readonly config: RateLimitConfig;
  private readonly connectionLimits: Map<string, RateLimitEntry> = new Map();
  private readonly messageLimits: Map<string, RateLimitEntry> = new Map();
  private readonly relayLimits: Map<string, RateLimitEntry> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_RATE_LIMIT_CONFIG, ...config };
  }

  /**
   * Start the rate limiter cleanup timer
   */
  start(): void {
    if (this.cleanupTimer) return;
    
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupIntervalMs);
  }

  /**
   * Stop the rate limiter and cleanup
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.connectionLimits.clear();
    this.messageLimits.clear();
    this.relayLimits.clear();
  }

  /**
   * Check if a connection from a peer should be allowed
   * 
   * @param peerId - The peer ID or IP address
   * @returns true if connection is allowed, false if rate limited
   */
  allowConnection(peerId: string): boolean {
    return this.checkLimit(
      this.connectionLimits,
      peerId,
      this.config.maxConnectionsPerSecond,
      this.config.windowSizeMs
    );
  }

  /**
   * Check if a message from a peer should be allowed
   * 
   * @param peerId - The peer ID
   * @returns true if message is allowed, false if rate limited
   */
  allowMessage(peerId: string): boolean {
    return this.checkLimit(
      this.messageLimits,
      peerId,
      this.config.maxMessagesPerSecond,
      this.config.windowSizeMs
    );
  }

  /**
   * Check if a relay request from a peer should be allowed
   * 
   * @param peerId - The peer ID
   * @returns true if relay request is allowed, false if rate limited
   */
  allowRelayRequest(peerId: string): boolean {
    return this.checkLimit(
      this.relayLimits,
      peerId,
      this.config.maxRelayRequestsPerMinute,
      60000 // 1 minute window for relay requests
    );
  }

  /**
   * Check if a peer is currently blocked
   * 
   * @param peerId - The peer ID
   * @returns true if peer is blocked
   */
  isBlocked(peerId: string): boolean {
    const entry = this.connectionLimits.get(peerId) || 
                  this.messageLimits.get(peerId) ||
                  this.relayLimits.get(peerId);
    
    if (!entry) return false;
    
    if (entry.blocked && entry.blockExpiry) {
      if (Date.now() > entry.blockExpiry) {
        entry.blocked = false;
        entry.blockExpiry = undefined;
        return false;
      }
      return true;
    }
    
    return false;
  }

  /**
   * Manually block a peer
   * 
   * @param peerId - The peer ID to block
   * @param durationMs - Block duration in milliseconds
   */
  blockPeer(peerId: string, durationMs: number): void {
    const entry: RateLimitEntry = {
      timestamps: [],
      blocked: true,
      blockExpiry: Date.now() + durationMs,
    };
    
    this.connectionLimits.set(peerId, entry);
    this.messageLimits.set(peerId, entry);
    this.relayLimits.set(peerId, entry);
  }

  /**
   * Unblock a peer
   * 
   * @param peerId - The peer ID to unblock
   */
  unblockPeer(peerId: string): void {
    this.connectionLimits.delete(peerId);
    this.messageLimits.delete(peerId);
    this.relayLimits.delete(peerId);
  }

  /**
   * Get rate limit statistics for a peer
   * 
   * @param peerId - The peer ID
   * @returns Statistics object
   */
  getStats(peerId: string): {
    connectionCount: number;
    messageCount: number;
    relayCount: number;
    isBlocked: boolean;
  } {
    const now = Date.now();
    
    const connEntry = this.connectionLimits.get(peerId);
    const msgEntry = this.messageLimits.get(peerId);
    const relayEntry = this.relayLimits.get(peerId);
    
    return {
      connectionCount: connEntry ? 
        connEntry.timestamps.filter(t => now - t < this.config.windowSizeMs).length : 0,
      messageCount: msgEntry ?
        msgEntry.timestamps.filter(t => now - t < this.config.windowSizeMs).length : 0,
      relayCount: relayEntry ?
        relayEntry.timestamps.filter(t => now - t < 60000).length : 0,
      isBlocked: this.isBlocked(peerId),
    };
  }

  /**
   * Check rate limit for a specific category
   */
  private checkLimit(
    limits: Map<string, RateLimitEntry>,
    peerId: string,
    maxRequests: number,
    windowMs: number
  ): boolean {
    const now = Date.now();
    
    let entry = limits.get(peerId);
    
    if (!entry) {
      entry = { timestamps: [], blocked: false };
      limits.set(peerId, entry);
    }
    
    // Check if blocked
    if (entry.blocked && entry.blockExpiry) {
      if (now > entry.blockExpiry) {
        entry.blocked = false;
        entry.blockExpiry = undefined;
      } else {
        return false;
      }
    }
    
    // Remove expired timestamps
    entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);
    
    // Check if over limit
    if (entry.timestamps.length >= maxRequests) {
      // Block for 10 seconds on rate limit violation
      entry.blocked = true;
      entry.blockExpiry = now + 10000;
      return false;
    }
    
    // Record this request
    entry.timestamps.push(now);
    
    return true;
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    
    for (const [peerId, entry] of this.connectionLimits) {
      // Remove entries with no recent activity and not blocked
      if (!entry.blocked && entry.timestamps.every(t => now - t > this.config.windowSizeMs * 2)) {
        this.connectionLimits.delete(peerId);
      }
    }
    
    for (const [peerId, entry] of this.messageLimits) {
      if (!entry.blocked && entry.timestamps.every(t => now - t > this.config.windowSizeMs * 2)) {
        this.messageLimits.delete(peerId);
      }
    }
    
    for (const [peerId, entry] of this.relayLimits) {
      if (!entry.blocked && entry.timestamps.every(t => now - t > 120000)) {
        this.relayLimits.delete(peerId);
      }
    }
  }
}

// ============================================================================
// Security Manager
// ============================================================================

/**
 * Callback for connection drop events
 */
export type ConnectionDropCallback = (peerId: string, reason: string) => void;

/**
 * Security manager that combines message validation and rate limiting.
 * 
 * Requirements: 9.1, 9.2, 9.5, 3.5
 */
export class SecurityManager {
  private readonly validator: MessageValidator;
  private readonly rateLimiter: RateLimiter;
  private readonly dropCallbacks: ConnectionDropCallback[] = [];
  private readonly droppedConnections: Map<string, { reason: string; timestamp: number }> = new Map();

  constructor(
    validationConfig: Partial<MessageValidationConfig> = {},
    rateLimitConfig: Partial<RateLimitConfig> = {}
  ) {
    this.validator = new MessageValidator(validationConfig);
    this.rateLimiter = new RateLimiter(rateLimitConfig);
  }

  /**
   * Start the security manager
   */
  start(): void {
    this.rateLimiter.start();
  }

  /**
   * Stop the security manager
   */
  stop(): void {
    this.rateLimiter.stop();
    this.droppedConnections.clear();
  }

  /**
   * Register a callback for connection drop events
   * 
   * @param callback - Function to call when a connection should be dropped
   * @returns Unsubscribe function
   */
  onConnectionDrop(callback: ConnectionDropCallback): () => void {
    this.dropCallbacks.push(callback);
    return () => {
      const index = this.dropCallbacks.indexOf(callback);
      if (index !== -1) {
        this.dropCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Process an incoming connection
   * 
   * @param peerId - The peer ID attempting to connect
   * @returns true if connection is allowed
   */
  processConnection(peerId: string): boolean {
    if (!this.rateLimiter.allowConnection(peerId)) {
      this.dropConnection(peerId, 'Rate limit exceeded for connections');
      return false;
    }
    return true;
  }

  /**
   * Process an incoming raw message
   * 
   * @param peerId - The peer ID that sent the message
   * @param data - Raw message bytes
   * @returns Validation result
   */
  processRawMessage(peerId: string, data: Uint8Array): ValidationResult {
    // Check rate limit first
    if (!this.rateLimiter.allowMessage(peerId)) {
      this.dropConnection(peerId, 'Rate limit exceeded for messages');
      return {
        valid: false,
        errorCode: OverlayErrorCode.INVALID_MESSAGE,
        errorMessage: 'Rate limit exceeded',
      };
    }

    // Validate raw message
    const result = this.validator.validateRawMessage(data);
    if (!result.valid) {
      this.dropConnection(peerId, result.errorMessage || 'Invalid message');
    }

    return result;
  }

  /**
   * Process a decoded message
   * 
   * @param peerId - The peer ID that sent the message
   * @param message - Decoded overlay message
   * @returns Validation result
   */
  processMessage(peerId: string, message: OverlayMessage): ValidationResult {
    const result = this.validator.validateMessage(message);
    if (!result.valid) {
      this.dropConnection(peerId, result.errorMessage || 'Invalid message');
    }
    return result;
  }

  /**
   * Process a relay request
   * 
   * @param peerId - The peer ID requesting relay
   * @returns true if relay request is allowed
   */
  processRelayRequest(peerId: string): boolean {
    if (!this.rateLimiter.allowRelayRequest(peerId)) {
      this.dropConnection(peerId, 'Rate limit exceeded for relay requests');
      return false;
    }
    return true;
  }

  /**
   * Check if a peer has been dropped
   * 
   * @param peerId - The peer ID to check
   * @returns Drop info if dropped, undefined otherwise
   */
  getDropInfo(peerId: string): { reason: string; timestamp: number } | undefined {
    return this.droppedConnections.get(peerId);
  }

  /**
   * Check if a peer is blocked
   * 
   * @param peerId - The peer ID to check
   * @returns true if blocked
   */
  isBlocked(peerId: string): boolean {
    return this.rateLimiter.isBlocked(peerId);
  }

  /**
   * Get the message validator instance
   */
  getValidator(): MessageValidator {
    return this.validator;
  }

  /**
   * Get the rate limiter instance
   */
  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  /**
   * Drop a connection and notify callbacks
   */
  private dropConnection(peerId: string, reason: string): void {
    // Record the drop
    this.droppedConnections.set(peerId, {
      reason,
      timestamp: Date.now(),
    });

    // Notify callbacks
    for (const callback of this.dropCallbacks) {
      try {
        callback(peerId, reason);
      } catch (error) {
        console.error('Error in connection drop callback:', error);
      }
    }
  }
}

/**
 * Create a default security manager instance
 */
export function createSecurityManager(
  validationConfig?: Partial<MessageValidationConfig>,
  rateLimitConfig?: Partial<RateLimitConfig>
): SecurityManager {
  return new SecurityManager(validationConfig, rateLimitConfig);
}
