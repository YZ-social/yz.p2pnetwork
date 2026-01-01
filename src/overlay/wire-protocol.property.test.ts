/**
 * Property-based tests for Wire Protocol
 *
 * Feature: overlay-messaging
 *
 * Tests the correctness properties of the WireProtocol class using
 * property-based testing with fast-check.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { WireProtocol } from './wire-protocol.js';
import { MessageType, UnreachableReason, CRYPTO_CONSTANTS } from './constants.js';
import type {
  RequestMessage,
  ResponseMessage,
  DuplicateMessage,
  UnreachableMessage,
  EncryptedPayload,
  HybridPublicKey,
  NodeAttestation,
} from './types.js';

const wireProtocol = new WireProtocol();

// ============================================================================
// Arbitraries for generating valid overlay messages
// ============================================================================

/**
 * Generate a valid UUID v4 string
 */
const uuidArbitrary = fc.uuid();

/**
 * Generate a valid peer ID string (base58-like format)
 */
const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const peerIdArbitrary: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0, max: base58Chars.length - 1 }), { minLength: 46, maxLength: 52 })
  .map((indices) => indices.map((i) => base58Chars[i]).join(''));

/**
 * Generate a valid TTL value (1-255)
 */
const ttlArbitrary = fc.integer({ min: 1, max: 255 });

/**
 * Generate a valid timestamp
 */
const timestampArbitrary = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });

/**
 * Generate a valid path (array of peer IDs)
 */
const pathArbitrary = fc.array(peerIdArbitrary, { minLength: 0, maxLength: 20 });

/**
 * Generate a valid X25519 public key (32 bytes)
 */
const x25519KeyArbitrary = fc.uint8Array({
  minLength: CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE,
  maxLength: CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE,
});

/**
 * Generate a valid ML-KEM-768 public key (1184 bytes)
 */
const mlkem768KeyArbitrary = fc.uint8Array({
  minLength: CRYPTO_CONSTANTS.MLKEM768_PUBLIC_KEY_SIZE,
  maxLength: CRYPTO_CONSTANTS.MLKEM768_PUBLIC_KEY_SIZE,
});

/**
 * Generate a valid hybrid public key
 */
const hybridPublicKeyArbitrary: fc.Arbitrary<HybridPublicKey> = fc.record({
  x25519: x25519KeyArbitrary,
  mlkem768: mlkem768KeyArbitrary,
});

/**
 * Generate a valid ML-KEM ciphertext (1088 bytes)
 */
const mlkemCiphertextArbitrary = fc.uint8Array({
  minLength: CRYPTO_CONSTANTS.MLKEM768_CIPHERTEXT_SIZE,
  maxLength: CRYPTO_CONSTANTS.MLKEM768_CIPHERTEXT_SIZE,
});

/**
 * Generate a valid AES-GCM nonce (12 bytes)
 */
const nonceArbitrary = fc.uint8Array({
  minLength: CRYPTO_CONSTANTS.AES_GCM_NONCE_SIZE,
  maxLength: CRYPTO_CONSTANTS.AES_GCM_NONCE_SIZE,
});

/**
 * Generate a valid AES-GCM auth tag (16 bytes)
 */
const authTagArbitrary = fc.uint8Array({
  minLength: CRYPTO_CONSTANTS.AES_GCM_TAG_SIZE,
  maxLength: CRYPTO_CONSTANTS.AES_GCM_TAG_SIZE,
});

/**
 * Generate a valid ciphertext (variable length, reasonable size for testing)
 */
const ciphertextArbitrary = fc.uint8Array({ minLength: 0, maxLength: 1024 });

/**
 * Generate a valid encrypted payload
 */
const encryptedPayloadArbitrary: fc.Arbitrary<EncryptedPayload> = fc.record({
  ephemeralX25519: x25519KeyArbitrary,
  mlkemCiphertext: mlkemCiphertextArbitrary,
  nonce: nonceArbitrary,
  ciphertext: ciphertextArbitrary,
  authTag: authTagArbitrary,
});

/**
 * Generate a valid signature (variable length)
 */
const signatureArbitrary = fc.uint8Array({ minLength: 64, maxLength: 128 });

/**
 * Generate a valid TEE type
 */
const teeTypeArbitrary = fc.option(
  fc.constantFrom('sgx' as const, 'nitro' as const, 'sev' as const),
  { nil: undefined }
);

/**
 * Generate a valid hex string for code hash (64 hex chars = 32 bytes)
 */
const hexChars = '0123456789abcdef';
const codeHashArbitrary: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0, max: 15 }), { minLength: 64, maxLength: 64 })
  .map((indices) => indices.map((i) => hexChars[i]).join(''));

/**
 * Generate a valid node attestation
 */
const nodeAttestationArbitrary: fc.Arbitrary<NodeAttestation> = fc.record({
  peerId: peerIdArbitrary,
  handlerCodeHash: codeHashArbitrary,
  timestamp: timestampArbitrary,
  signature: signatureArbitrary,
  teeType: teeTypeArbitrary,
  teeAttestation: fc.option(fc.uint8Array({ minLength: 32, maxLength: 256 }), {
    nil: undefined,
  }),
});


/**
 * Generate a valid REQUEST message
 */
const requestMessageArbitrary: fc.Arbitrary<RequestMessage> = fc.record({
  type: fc.constant(MessageType.REQUEST as typeof MessageType.REQUEST),
  messageId: uuidArbitrary,
  originPeerId: peerIdArbitrary,
  targetPeerId: peerIdArbitrary,
  ttl: ttlArbitrary,
  timestamp: timestampArbitrary,
  path: pathArbitrary,
  originPublicKey: hybridPublicKeyArbitrary,
  encryptedPayload: encryptedPayloadArbitrary,
  requestAttestation: fc.option(fc.boolean(), { nil: undefined }),
});

/**
 * Generate a valid RESPONSE message (success case)
 */
const successResponseArbitrary: fc.Arbitrary<ResponseMessage> = fc.record({
  type: fc.constant(MessageType.RESPONSE as typeof MessageType.RESPONSE),
  messageId: uuidArbitrary,
  originPeerId: peerIdArbitrary,
  targetPeerId: peerIdArbitrary,
  path: pathArbitrary,
  encryptedPayload: encryptedPayloadArbitrary,
  success: fc.constant(true),
  errorMessage: fc.constant(undefined),
  attestation: fc.option(nodeAttestationArbitrary, { nil: undefined }),
});

/**
 * Generate a valid RESPONSE message (error case)
 */
const errorResponseArbitrary: fc.Arbitrary<ResponseMessage> = fc.record({
  type: fc.constant(MessageType.RESPONSE as typeof MessageType.RESPONSE),
  messageId: uuidArbitrary,
  originPeerId: peerIdArbitrary,
  targetPeerId: peerIdArbitrary,
  path: pathArbitrary,
  encryptedPayload: encryptedPayloadArbitrary,
  success: fc.constant(false),
  errorMessage: fc.option(fc.string({ minLength: 0, maxLength: 256 }), { nil: undefined }),
  attestation: fc.option(nodeAttestationArbitrary, { nil: undefined }),
});

/**
 * Generate any valid RESPONSE message
 */
const responseMessageArbitrary: fc.Arbitrary<ResponseMessage> = fc.oneof(
  successResponseArbitrary,
  errorResponseArbitrary
);

/**
 * Generate a valid DUPLICATE message
 */
const duplicateMessageArbitrary: fc.Arbitrary<DuplicateMessage> = fc.record({
  type: fc.constant(MessageType.DUPLICATE as typeof MessageType.DUPLICATE),
  messageId: uuidArbitrary,
});

/**
 * Generate a valid unreachable reason
 */
const unreachableReasonArbitrary = fc.constantFrom(
  UnreachableReason.TTL_EXPIRED,
  UnreachableReason.TARGET_NOT_FOUND,
  UnreachableReason.NO_ROUTE,
  UnreachableReason.NO_HANDLER,
  UnreachableReason.DECRYPTION_FAILED,
  UnreachableReason.ATTESTATION_FAILED
);

/**
 * Generate a valid UNREACHABLE message
 */
const unreachableMessageArbitrary: fc.Arbitrary<UnreachableMessage> = fc.record({
  type: fc.constant(MessageType.UNREACHABLE as typeof MessageType.UNREACHABLE),
  messageId: uuidArbitrary,
  reason: unreachableReasonArbitrary,
});

// ============================================================================
// Helper functions for comparing messages
// ============================================================================

function compareUint8Arrays(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function compareEncryptedPayloads(a: EncryptedPayload, b: EncryptedPayload): boolean {
  return (
    compareUint8Arrays(a.ephemeralX25519, b.ephemeralX25519) &&
    compareUint8Arrays(a.mlkemCiphertext, b.mlkemCiphertext) &&
    compareUint8Arrays(a.nonce, b.nonce) &&
    compareUint8Arrays(a.ciphertext, b.ciphertext) &&
    compareUint8Arrays(a.authTag, b.authTag)
  );
}

function compareHybridPublicKeys(a: HybridPublicKey, b: HybridPublicKey): boolean {
  return (
    compareUint8Arrays(a.x25519, b.x25519) && compareUint8Arrays(a.mlkem768, b.mlkem768)
  );
}

function compareAttestations(
  a: NodeAttestation | undefined,
  b: NodeAttestation | undefined
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return (
    a.peerId === b.peerId &&
    a.handlerCodeHash === b.handlerCodeHash &&
    a.timestamp === b.timestamp &&
    compareUint8Arrays(a.signature, b.signature) &&
    a.teeType === b.teeType &&
    (a.teeAttestation === undefined && b.teeAttestation === undefined ||
      (a.teeAttestation !== undefined &&
        b.teeAttestation !== undefined &&
        compareUint8Arrays(a.teeAttestation, b.teeAttestation)))
  );
}

function compareRequestMessages(a: RequestMessage, b: RequestMessage): boolean {
  return (
    a.type === b.type &&
    a.messageId === b.messageId &&
    a.originPeerId === b.originPeerId &&
    a.targetPeerId === b.targetPeerId &&
    a.ttl === b.ttl &&
    a.timestamp === b.timestamp &&
    JSON.stringify(a.path) === JSON.stringify(b.path) &&
    compareHybridPublicKeys(a.originPublicKey, b.originPublicKey) &&
    compareEncryptedPayloads(a.encryptedPayload, b.encryptedPayload) &&
    // Handle requestAttestation: both undefined/false are equivalent
    (!!a.requestAttestation) === (!!b.requestAttestation)
  );
}

function compareResponseMessages(a: ResponseMessage, b: ResponseMessage): boolean {
  return (
    a.type === b.type &&
    a.messageId === b.messageId &&
    a.originPeerId === b.originPeerId &&
    a.targetPeerId === b.targetPeerId &&
    JSON.stringify(a.path) === JSON.stringify(b.path) &&
    compareEncryptedPayloads(a.encryptedPayload, b.encryptedPayload) &&
    a.success === b.success &&
    // Handle empty string vs undefined for errorMessage
    (a.errorMessage || '') === (b.errorMessage || '') &&
    compareAttestations(a.attestation, b.attestation)
  );
}

function compareDuplicateMessages(a: DuplicateMessage, b: DuplicateMessage): boolean {
  return a.type === b.type && a.messageId === b.messageId;
}

function compareUnreachableMessages(
  a: UnreachableMessage,
  b: UnreachableMessage
): boolean {
  return a.type === b.type && a.messageId === b.messageId && a.reason === b.reason;
}


// ============================================================================
// Property Tests
// ============================================================================

/**
 * Feature: overlay-messaging, Property 2: Message Serialization Round-Trip
 *
 * *For any* valid OverlayMessage (REQUEST, RESPONSE, DUPLICATE, or UNREACHABLE),
 * encoding then decoding the message produces an equivalent message with all
 * fields preserved.
 *
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.6, 6.7**
 */
describe('Property 2: Message Serialization Round-Trip', () => {
  it('REQUEST message round-trip preserves all fields', () => {
    fc.assert(
      fc.property(requestMessageArbitrary, (message) => {
        // Encode the message
        const encoded = wireProtocol.encodeRequest(message);

        // Decode the message
        const decoded = wireProtocol.decode(encoded);

        // Verify it's a REQUEST message
        expect(decoded.type).toBe(MessageType.REQUEST);

        // Verify all fields are preserved
        expect(compareRequestMessages(message, decoded as RequestMessage)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('RESPONSE message (success) round-trip preserves all fields', () => {
    fc.assert(
      fc.property(successResponseArbitrary, (message) => {
        // Encode the message
        const encoded = wireProtocol.encodeResponse(message);

        // Decode the message
        const decoded = wireProtocol.decode(encoded);

        // Verify it's a RESPONSE message
        expect(decoded.type).toBe(MessageType.RESPONSE);

        // Verify all fields are preserved
        expect(compareResponseMessages(message, decoded as ResponseMessage)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('RESPONSE message (error) round-trip preserves all fields', () => {
    fc.assert(
      fc.property(errorResponseArbitrary, (message) => {
        // Encode the message
        const encoded = wireProtocol.encodeResponse(message);

        // Decode the message
        const decoded = wireProtocol.decode(encoded);

        // Verify it's a RESPONSE message
        expect(decoded.type).toBe(MessageType.RESPONSE);

        // Verify all fields are preserved
        expect(compareResponseMessages(message, decoded as ResponseMessage)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('DUPLICATE message round-trip preserves all fields', () => {
    fc.assert(
      fc.property(duplicateMessageArbitrary, (message) => {
        // Encode the message
        const encoded = wireProtocol.encodeDuplicate(message.messageId);

        // Decode the message
        const decoded = wireProtocol.decode(encoded);

        // Verify it's a DUPLICATE message
        expect(decoded.type).toBe(MessageType.DUPLICATE);

        // Verify all fields are preserved
        expect(compareDuplicateMessages(message, decoded as DuplicateMessage)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('UNREACHABLE message round-trip preserves all fields', () => {
    fc.assert(
      fc.property(unreachableMessageArbitrary, (message) => {
        // Encode the message
        const encoded = wireProtocol.encodeUnreachable(message.messageId, message.reason);

        // Decode the message
        const decoded = wireProtocol.decode(encoded);

        // Verify it's an UNREACHABLE message
        expect(decoded.type).toBe(MessageType.UNREACHABLE);

        // Verify all fields are preserved
        expect(compareUnreachableMessages(message, decoded as UnreachableMessage)).toBe(
          true
        );
      }),
      { numRuns: 100 }
    );
  });

  it('RESPONSE message with attestation round-trip preserves attestation', () => {
    const responseWithAttestationArbitrary = fc.record({
      type: fc.constant(MessageType.RESPONSE as typeof MessageType.RESPONSE),
      messageId: uuidArbitrary,
      originPeerId: peerIdArbitrary,
      targetPeerId: peerIdArbitrary,
      path: pathArbitrary,
      encryptedPayload: encryptedPayloadArbitrary,
      success: fc.boolean(),
      errorMessage: fc.option(fc.string({ minLength: 0, maxLength: 256 }), { nil: undefined }),
      attestation: nodeAttestationArbitrary, // Always include attestation
    });

    fc.assert(
      fc.property(responseWithAttestationArbitrary, (message) => {
        // Encode the message
        const encoded = wireProtocol.encodeResponse(message);

        // Decode the message
        const decoded = wireProtocol.decode(encoded) as ResponseMessage;

        // Verify attestation is preserved
        expect(decoded.attestation).toBeDefined();
        expect(compareAttestations(message.attestation, decoded.attestation)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('validates message size correctly', () => {
    fc.assert(
      fc.property(
        requestMessageArbitrary,
        fc.integer({ min: 1, max: 100000 }),
        (message, maxSize) => {
          const encoded = wireProtocol.encodeRequest(message);
          const isValid = wireProtocol.validateSize(encoded, maxSize);

          // validateSize should return true if encoded.length <= maxSize
          expect(isValid).toBe(encoded.length <= maxSize);
        }
      ),
      { numRuns: 100 }
    );
  });
});
