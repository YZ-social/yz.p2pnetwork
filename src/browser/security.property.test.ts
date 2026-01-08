/**
 * Property-based tests for Security Module
 * 
 * Feature: browser-libp2p-nodes
 * 
 * Tests:
 * - Property 9: Message Validation and Security
 * 
 * **Validates: Requirements 9.1, 9.2, 9.5**
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
  MessageValidator,
  RateLimiter,
  SecurityManager,
  DEFAULT_MESSAGE_VALIDATION_CONFIG,
  DEFAULT_RATE_LIMIT_CONFIG,
} from './security.js';
import { MessageType, CRYPTO_CONSTANTS } from '../overlay/constants.js';
import type { RequestMessage, ResponseMessage, EncryptedPayload, HybridPublicKey } from '../overlay/types.js';

// ============================================================================
// Arbitraries for generating test data
// ============================================================================

/**
 * Generate a valid UUID v4 string
 */
const validUuidArbitrary = fc.uuid();

/**
 * Generate an invalid UUID string (strings that don't match UUID format)
 */
const invalidUuidArbitrary = fc.oneof(
  fc.constant(''), // Empty
  fc.constant('not-a-uuid'), // Not a UUID
  fc.constant('12345678-1234-1234-1234-12345678901'), // Too short (35 chars)
  fc.constant('12345678-1234-1234-1234-1234567890123'), // Too long (37 chars)
  fc.constant('12345678_1234_1234_1234_123456789012'), // Wrong separator
  fc.constant('ZZZZZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZZZZZZZZZ'), // Invalid hex chars
);

/**
 * Generate a valid peer ID (alphanumeric)
 */
const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const validPeerIdArbitrary: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0, max: base58Chars.length - 1 }), { minLength: 10, maxLength: 60 })
  .map((indices) => indices.map((i) => base58Chars[i]).join(''));

/**
 * Generate an invalid peer ID
 */
const invalidPeerIdArbitrary = fc.oneof(
  fc.constant(''), // Empty
  fc.constant('!@#$%^&*()'), // Special chars only
  fc.string({ minLength: 200, maxLength: 300 }), // Too long
);

/**
 * Generate a valid X25519 public key (32 bytes)
 */
const validX25519KeyArbitrary = fc.uint8Array({
  minLength: CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE,
  maxLength: CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE,
});

/**
 * Generate an invalid X25519 public key (wrong size)
 */
const invalidX25519KeyArbitrary = fc.oneof(
  fc.uint8Array({ minLength: 0, maxLength: 31 }),
  fc.uint8Array({ minLength: 33, maxLength: 64 }),
);

/**
 * Generate a valid ML-KEM-768 public key (1184 bytes)
 */
const validMlkem768KeyArbitrary = fc.uint8Array({
  minLength: CRYPTO_CONSTANTS.MLKEM768_PUBLIC_KEY_SIZE,
  maxLength: CRYPTO_CONSTANTS.MLKEM768_PUBLIC_KEY_SIZE,
});

/**
 * Generate a valid hybrid public key
 */
const validHybridPublicKeyArbitrary: fc.Arbitrary<HybridPublicKey> = fc.record({
  x25519: validX25519KeyArbitrary,
  mlkem768: validMlkem768KeyArbitrary,
});

/**
 * Generate a valid encrypted payload
 */
const validEncryptedPayloadArbitrary: fc.Arbitrary<EncryptedPayload> = fc.record({
  ephemeralX25519: validX25519KeyArbitrary,
  mlkemCiphertext: fc.uint8Array({
    minLength: CRYPTO_CONSTANTS.MLKEM768_CIPHERTEXT_SIZE,
    maxLength: CRYPTO_CONSTANTS.MLKEM768_CIPHERTEXT_SIZE,
  }),
  nonce: fc.uint8Array({
    minLength: CRYPTO_CONSTANTS.AES_GCM_NONCE_SIZE,
    maxLength: CRYPTO_CONSTANTS.AES_GCM_NONCE_SIZE,
  }),
  ciphertext: fc.uint8Array({ minLength: 0, maxLength: 1024 }),
  authTag: fc.uint8Array({
    minLength: CRYPTO_CONSTANTS.AES_GCM_TAG_SIZE,
    maxLength: CRYPTO_CONSTANTS.AES_GCM_TAG_SIZE,
  }),
});

/**
 * Generate a valid path (array of unique peer IDs)
 */
const validPathArbitrary: fc.Arbitrary<string[]> = fc.array(validPeerIdArbitrary, { minLength: 0, maxLength: 10 })
  .map(path => [...new Set(path)]);

/**
 * Generate a valid REQUEST message
 */
const validRequestMessageArbitrary: fc.Arbitrary<RequestMessage> = fc.record({
  type: fc.constant(MessageType.REQUEST as typeof MessageType.REQUEST),
  messageId: validUuidArbitrary,
  originPeerId: validPeerIdArbitrary,
  targetPeerId: validPeerIdArbitrary,
  ttl: fc.integer({ min: 1, max: 255 }),
  timestamp: fc.integer({ min: Date.now() - 60000, max: Date.now() + 60000 }),
  path: validPathArbitrary,
  originPublicKey: validHybridPublicKeyArbitrary,
  encryptedPayload: validEncryptedPayloadArbitrary,
  requestAttestation: fc.option(fc.boolean(), { nil: undefined }),
});

/**
 * Generate a valid RESPONSE message
 */
const validResponseMessageArbitrary: fc.Arbitrary<ResponseMessage> = fc.record({
  type: fc.constant(MessageType.RESPONSE as typeof MessageType.RESPONSE),
  messageId: validUuidArbitrary,
  originPeerId: validPeerIdArbitrary,
  targetPeerId: validPeerIdArbitrary,
  path: validPathArbitrary,
  encryptedPayload: validEncryptedPayloadArbitrary,
  success: fc.boolean(),
  errorMessage: fc.option(fc.string({ minLength: 0, maxLength: 256 }), { nil: undefined }),
  attestation: fc.constant(undefined),
});

// ============================================================================
// Property 9: Message Validation and Security
// ============================================================================

/**
 * Feature: browser-libp2p-nodes, Property 9: Message Validation and Security
 * 
 * For any incoming message to a browser node:
 * - If the message is invalid according to protocol specifications, the connection SHALL be dropped
 * - The node SHALL rate-limit incoming connections to prevent DoS attacks
 * 
 * **Validates: Requirements 9.1, 9.2, 9.5**
 */
describe('Property 9: Message Validation and Security', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Message Validation', () => {
    /**
     * Test: Valid messages pass validation
     * 
     * For any valid REQUEST message, validation SHALL succeed.
     */
    it('valid REQUEST messages pass validation', () => {
      const validator = new MessageValidator();

      fc.assert(
        fc.property(validRequestMessageArbitrary, (message) => {
          const result = validator.validateMessage(message);
          expect(result.valid).toBe(true);
          expect(result.errorCode).toBeUndefined();
          expect(result.errorMessage).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Valid RESPONSE messages pass validation
     * 
     * For any valid RESPONSE message, validation SHALL succeed.
     */
    it('valid RESPONSE messages pass validation', () => {
      const validator = new MessageValidator();

      fc.assert(
        fc.property(validResponseMessageArbitrary, (message) => {
          const result = validator.validateMessage(message);
          expect(result.valid).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Invalid UUID causes validation failure
     * 
     * For any message with an invalid UUID, validation SHALL fail.
     */
    it('invalid UUID causes validation failure', () => {
      const validator = new MessageValidator();

      fc.assert(
        fc.property(
          validRequestMessageArbitrary,
          invalidUuidArbitrary,
          (message, invalidUuid) => {
            const invalidMessage = { ...message, messageId: invalidUuid };
            const result = validator.validateMessage(invalidMessage);
            expect(result.valid).toBe(false);
            expect(result.errorMessage).toContain('Invalid message ID');
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Empty peer ID causes validation failure
     * 
     * For any message with an empty origin or target peer ID, validation SHALL fail.
     */
    it('empty peer ID causes validation failure', () => {
      const validator = new MessageValidator();

      fc.assert(
        fc.property(validRequestMessageArbitrary, (message) => {
          // Test empty origin peer ID
          const emptyOrigin = { ...message, originPeerId: '' };
          const originResult = validator.validateMessage(emptyOrigin);
          expect(originResult.valid).toBe(false);
          expect(originResult.errorMessage).toContain('Empty origin peer ID');

          // Test empty target peer ID
          const emptyTarget = { ...message, targetPeerId: '' };
          const targetResult = validator.validateMessage(emptyTarget);
          expect(targetResult.valid).toBe(false);
          expect(targetResult.errorMessage).toContain('Empty target peer ID');
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Invalid TTL causes validation failure
     * 
     * For any message with TTL outside valid range, validation SHALL fail.
     */
    it('invalid TTL causes validation failure', () => {
      const validator = new MessageValidator();

      fc.assert(
        fc.property(
          validRequestMessageArbitrary,
          fc.oneof(
            fc.integer({ min: -1000, max: -1 }),
            fc.integer({ min: 256, max: 1000 })
          ),
          (message, invalidTtl) => {
            const invalidMessage = { ...message, ttl: invalidTtl };
            const result = validator.validateMessage(invalidMessage);
            expect(result.valid).toBe(false);
            expect(result.errorMessage).toContain('Invalid TTL');
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Timestamp drift causes validation failure
     * 
     * For any message with timestamp too far in past or future, validation SHALL fail.
     */
    it('excessive timestamp drift causes validation failure', () => {
      const validator = new MessageValidator();
      const maxDrift = DEFAULT_MESSAGE_VALIDATION_CONFIG.maxTimestampDrift;

      fc.assert(
        fc.property(
          validRequestMessageArbitrary,
          fc.oneof(
            fc.integer({ min: -1000000000, max: Date.now() - maxDrift - 1000 }),
            fc.integer({ min: Date.now() + maxDrift + 1000, max: Date.now() + 1000000000 })
          ),
          (message, invalidTimestamp) => {
            const invalidMessage = { ...message, timestamp: invalidTimestamp };
            const result = validator.validateMessage(invalidMessage);
            expect(result.valid).toBe(false);
            expect(result.errorMessage).toContain('Timestamp drift');
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Duplicate peer IDs in path causes validation failure (loop detection)
     * 
     * For any message with duplicate peer IDs in path, validation SHALL fail.
     */
    it('duplicate peer IDs in path causes validation failure', () => {
      const validator = new MessageValidator();

      fc.assert(
        fc.property(
          validRequestMessageArbitrary,
          validPeerIdArbitrary,
          (message, duplicatePeerId) => {
            // Create path with duplicate
            const pathWithDuplicate = [duplicatePeerId, 'otherPeer123', duplicatePeerId];
            const invalidMessage = { ...message, path: pathWithDuplicate };
            const result = validator.validateMessage(invalidMessage);
            expect(result.valid).toBe(false);
            expect(result.errorMessage).toContain('Duplicate peer ID in path');
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Invalid X25519 key size causes validation failure
     * 
     * For any message with wrong X25519 key size, validation SHALL fail.
     */
    it('invalid X25519 key size causes validation failure', () => {
      const validator = new MessageValidator();

      fc.assert(
        fc.property(
          validRequestMessageArbitrary,
          invalidX25519KeyArbitrary,
          (message, invalidKey) => {
            const invalidMessage = {
              ...message,
              originPublicKey: {
                ...message.originPublicKey,
                x25519: invalidKey,
              },
            };
            const result = validator.validateMessage(invalidMessage);
            expect(result.valid).toBe(false);
            expect(result.errorMessage).toContain('Invalid X25519 key size');
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Raw message size validation
     * 
     * For any raw message exceeding max size, validation SHALL fail.
     */
    it('oversized raw messages fail validation', () => {
      const validator = new MessageValidator();
      const maxSize = DEFAULT_MESSAGE_VALIDATION_CONFIG.maxMessageSize;

      fc.assert(
        fc.property(
          fc.uint8Array({ minLength: maxSize + 1, maxLength: maxSize + 1000 }),
          (oversizedData) => {
            const result = validator.validateRawMessage(oversizedData);
            expect(result.valid).toBe(false);
            expect(result.errorMessage).toContain('exceeds maximum');
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Empty raw message fails validation
     * 
     * For any empty raw message, validation SHALL fail.
     */
    it('empty raw messages fail validation', () => {
      const validator = new MessageValidator();
      const result = validator.validateRawMessage(new Uint8Array(0));
      expect(result.valid).toBe(false);
      expect(result.errorMessage).toContain('Empty message');
    });

    /**
     * Test: Invalid message type in header fails validation
     * 
     * Note: The wire protocol uses the lower 2 bits for message type (0-3).
     * Since any byte value maps to a valid type (0-3) via masking, this test
     * verifies that the raw message validation correctly extracts and validates
     * the message type from the header byte.
     */
    it('valid message types in header pass validation', () => {
      const validator = new MessageValidator();

      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 3 }), // Valid message types
          (validType) => {
            // Create a minimal valid raw message with the type in lower 2 bits
            const data = new Uint8Array([validType]);
            const result = validator.validateRawMessage(data);
            expect(result.valid).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Rate Limiting', () => {
    /**
     * Test: Connections within limit are allowed
     * 
     * For any peer making connections within the rate limit, all connections SHALL be allowed.
     */
    it('connections within limit are allowed', () => {
      fc.assert(
        fc.property(
          validPeerIdArbitrary,
          fc.integer({ min: 1, max: DEFAULT_RATE_LIMIT_CONFIG.maxConnectionsPerSecond }),
          (peerId, connectionCount) => {
            const rateLimiter = new RateLimiter();
            rateLimiter.start();

            let allowedCount = 0;
            for (let i = 0; i < connectionCount; i++) {
              if (rateLimiter.allowConnection(peerId)) {
                allowedCount++;
              }
            }

            expect(allowedCount).toBe(connectionCount);
            rateLimiter.stop();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Connections exceeding limit are blocked
     * 
     * For any peer exceeding the connection rate limit, excess connections SHALL be blocked.
     */
    it('connections exceeding limit are blocked', () => {
      fc.assert(
        fc.property(
          validPeerIdArbitrary,
          fc.integer({ min: 1, max: 5 }),
          (peerId, excessCount) => {
            const maxConnections = 5;
            const rateLimiter = new RateLimiter({ maxConnectionsPerSecond: maxConnections });
            rateLimiter.start();

            // Make connections up to limit
            for (let i = 0; i < maxConnections; i++) {
              rateLimiter.allowConnection(peerId);
            }

            // Excess connections should be blocked
            for (let i = 0; i < excessCount; i++) {
              const allowed = rateLimiter.allowConnection(peerId);
              expect(allowed).toBe(false);
            }

            rateLimiter.stop();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Messages within limit are allowed
     * 
     * For any peer sending messages within the rate limit, all messages SHALL be allowed.
     */
    it('messages within limit are allowed', () => {
      fc.assert(
        fc.property(
          validPeerIdArbitrary,
          fc.integer({ min: 1, max: DEFAULT_RATE_LIMIT_CONFIG.maxMessagesPerSecond }),
          (peerId, messageCount) => {
            const rateLimiter = new RateLimiter();
            rateLimiter.start();

            let allowedCount = 0;
            for (let i = 0; i < messageCount; i++) {
              if (rateLimiter.allowMessage(peerId)) {
                allowedCount++;
              }
            }

            expect(allowedCount).toBe(messageCount);
            rateLimiter.stop();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Relay requests within limit are allowed
     * 
     * For any peer making relay requests within the limit, all requests SHALL be allowed.
     */
    it('relay requests within limit are allowed', () => {
      fc.assert(
        fc.property(
          validPeerIdArbitrary,
          fc.integer({ min: 1, max: DEFAULT_RATE_LIMIT_CONFIG.maxRelayRequestsPerMinute }),
          (peerId, requestCount) => {
            const rateLimiter = new RateLimiter();
            rateLimiter.start();

            let allowedCount = 0;
            for (let i = 0; i < requestCount; i++) {
              if (rateLimiter.allowRelayRequest(peerId)) {
                allowedCount++;
              }
            }

            expect(allowedCount).toBe(requestCount);
            rateLimiter.stop();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Blocked peers remain blocked until expiry
     * 
     * For any manually blocked peer, they SHALL remain blocked until the block expires.
     */
    it('blocked peers remain blocked until expiry', () => {
      fc.assert(
        fc.property(
          validPeerIdArbitrary,
          fc.integer({ min: 1000, max: 10000 }),
          (peerId, blockDuration) => {
            const rateLimiter = new RateLimiter();
            rateLimiter.start();

            // Block the peer
            rateLimiter.blockPeer(peerId, blockDuration);

            // Should be blocked
            expect(rateLimiter.isBlocked(peerId)).toBe(true);
            expect(rateLimiter.allowConnection(peerId)).toBe(false);
            expect(rateLimiter.allowMessage(peerId)).toBe(false);

            // Advance time past block expiry
            vi.advanceTimersByTime(blockDuration + 100);

            // Should no longer be blocked
            expect(rateLimiter.isBlocked(peerId)).toBe(false);

            rateLimiter.stop();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Unblocking a peer allows connections again
     * 
     * For any blocked peer, unblocking them SHALL allow connections again.
     */
    it('unblocking a peer allows connections again', () => {
      fc.assert(
        fc.property(validPeerIdArbitrary, (peerId) => {
          const rateLimiter = new RateLimiter();
          rateLimiter.start();

          // Block the peer
          rateLimiter.blockPeer(peerId, 60000);
          expect(rateLimiter.isBlocked(peerId)).toBe(true);

          // Unblock the peer
          rateLimiter.unblockPeer(peerId);
          expect(rateLimiter.isBlocked(peerId)).toBe(false);

          // Should be able to connect again
          expect(rateLimiter.allowConnection(peerId)).toBe(true);

          rateLimiter.stop();
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Different peers have independent rate limits
     * 
     * For any two different peers, their rate limits SHALL be independent.
     */
    it('different peers have independent rate limits', () => {
      fc.assert(
        fc.property(
          validPeerIdArbitrary,
          validPeerIdArbitrary,
          (peerId1, peerId2) => {
            // Ensure different peer IDs
            if (peerId1 === peerId2) return;

            const maxConnections = 5;
            const rateLimiter = new RateLimiter({ maxConnectionsPerSecond: maxConnections });
            rateLimiter.start();

            // Exhaust peer1's limit
            for (let i = 0; i < maxConnections; i++) {
              rateLimiter.allowConnection(peerId1);
            }

            // peer1 should be blocked
            expect(rateLimiter.allowConnection(peerId1)).toBe(false);

            // peer2 should still be allowed
            expect(rateLimiter.allowConnection(peerId2)).toBe(true);

            rateLimiter.stop();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Security Manager Integration', () => {
    /**
     * Test: Invalid messages trigger connection drop callback
     * 
     * For any invalid message, the security manager SHALL trigger a connection drop.
     */
    it('invalid messages trigger connection drop callback', () => {
      fc.assert(
        fc.property(
          validPeerIdArbitrary,
          validRequestMessageArbitrary,
          invalidUuidArbitrary,
          (peerId, message, invalidUuid) => {
            const securityManager = new SecurityManager();
            securityManager.start();

            const dropEvents: { peerId: string; reason: string }[] = [];
            securityManager.onConnectionDrop((droppedPeerId, reason) => {
              dropEvents.push({ peerId: droppedPeerId, reason });
            });

            // Process invalid message
            const invalidMessage = { ...message, messageId: invalidUuid };
            const result = securityManager.processMessage(peerId, invalidMessage);

            expect(result.valid).toBe(false);
            expect(dropEvents.length).toBe(1);
            expect(dropEvents[0].peerId).toBe(peerId);

            securityManager.stop();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Rate limited connections trigger connection drop
     * 
     * For any peer exceeding rate limits, the security manager SHALL trigger a connection drop.
     */
    it('rate limited connections trigger connection drop', () => {
      fc.assert(
        fc.property(validPeerIdArbitrary, (peerId) => {
          const maxConnections = 3;
          const securityManager = new SecurityManager(
            {},
            { maxConnectionsPerSecond: maxConnections }
          );
          securityManager.start();

          const dropEvents: { peerId: string; reason: string }[] = [];
          securityManager.onConnectionDrop((droppedPeerId, reason) => {
            dropEvents.push({ peerId: droppedPeerId, reason });
          });

          // Make connections up to limit
          for (let i = 0; i < maxConnections; i++) {
            securityManager.processConnection(peerId);
          }

          // Excess connection should trigger drop
          const allowed = securityManager.processConnection(peerId);
          expect(allowed).toBe(false);
          expect(dropEvents.length).toBe(1);
          expect(dropEvents[0].reason).toContain('Rate limit');

          securityManager.stop();
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Valid messages from non-rate-limited peers are accepted
     * 
     * For any valid message from a peer within rate limits, processing SHALL succeed.
     */
    it('valid messages from non-rate-limited peers are accepted', () => {
      fc.assert(
        fc.property(
          validPeerIdArbitrary,
          validRequestMessageArbitrary,
          (peerId, message) => {
            const securityManager = new SecurityManager();
            securityManager.start();

            const dropEvents: string[] = [];
            securityManager.onConnectionDrop((droppedPeerId) => {
              dropEvents.push(droppedPeerId);
            });

            const result = securityManager.processMessage(peerId, message);

            expect(result.valid).toBe(true);
            expect(dropEvents.length).toBe(0);

            securityManager.stop();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Drop info is recorded for dropped connections
     * 
     * For any dropped connection, the drop info SHALL be retrievable.
     */
    it('drop info is recorded for dropped connections', () => {
      fc.assert(
        fc.property(
          validPeerIdArbitrary,
          validRequestMessageArbitrary,
          invalidUuidArbitrary,
          (peerId, message, invalidUuid) => {
            const securityManager = new SecurityManager();
            securityManager.start();

            // Process invalid message to trigger drop
            const invalidMessage = { ...message, messageId: invalidUuid };
            securityManager.processMessage(peerId, invalidMessage);

            // Drop info should be recorded
            const dropInfo = securityManager.getDropInfo(peerId);
            expect(dropInfo).toBeDefined();
            expect(dropInfo!.reason).toContain('Invalid message ID');
            expect(dropInfo!.timestamp).toBeGreaterThan(0);

            securityManager.stop();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Test: Relay request rate limiting works through security manager
     * 
     * For any peer exceeding relay request limits, the security manager SHALL block them.
     */
    it('relay request rate limiting works through security manager', () => {
      fc.assert(
        fc.property(validPeerIdArbitrary, (peerId) => {
          const maxRelayRequests = 5;
          const securityManager = new SecurityManager(
            {},
            { maxRelayRequestsPerMinute: maxRelayRequests }
          );
          securityManager.start();

          // Make requests up to limit
          for (let i = 0; i < maxRelayRequests; i++) {
            expect(securityManager.processRelayRequest(peerId)).toBe(true);
          }

          // Excess request should be blocked
          expect(securityManager.processRelayRequest(peerId)).toBe(false);

          securityManager.stop();
        }),
        { numRuns: 100 }
      );
    });
  });
});
