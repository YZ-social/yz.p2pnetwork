/**
 * Wire Protocol for Overlay Messaging Network
 *
 * Implements binary serialization/deserialization for overlay messages.
 * Uses a compact binary format as specified in the design document.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */

import { MessageType, UnreachableReason, CRYPTO_CONSTANTS, OVERLAY_PROTOCOL_ID } from './constants.js';
import { OverlayError, OverlayErrorCode } from './errors.js';
import type {
  RequestMessage,
  ResponseMessage,
  DuplicateMessage,
  UnreachableMessage,
  OverlayMessage,
  EncryptedPayload,
  HybridPublicKey,
  NodeAttestation,
} from './types.js';

/**
 * Wire protocol handler for overlay messages.
 *
 * Binary format:
 * - Header byte: bits 0-1 = message type, bit 2 = attestation flag
 * - Metadata: varies by message type
 * - Encrypted data: for REQUEST/RESPONSE messages
 */
export class WireProtocol {
  /** Protocol identifier for libp2p */
  readonly protocolId: string = OVERLAY_PROTOCOL_ID;

  private readonly textEncoder = new TextEncoder();
  private readonly textDecoder = new TextDecoder();

  /**
   * Encodes a REQUEST message to binary format.
   *
   * Requirement 6.1, 6.6, 6.7
   */
  encodeRequest(message: RequestMessage): Uint8Array {
    const parts: Uint8Array[] = [];

    // Header byte: type (bits 0-1) + attestation flag (bit 2)
    const header = MessageType.REQUEST | (message.requestAttestation ? 0x04 : 0);
    parts.push(new Uint8Array([header]));

    // Message ID (16 bytes - UUID as bytes)
    parts.push(this.encodeUUID(message.messageId));

    // Origin peer ID (length-prefixed)
    parts.push(this.encodeLengthPrefixedString(message.originPeerId));

    // Target peer ID (length-prefixed)
    parts.push(this.encodeLengthPrefixedString(message.targetPeerId));

    // TTL (1 byte)
    parts.push(new Uint8Array([message.ttl]));

    // Timestamp (8 bytes, uint64)
    parts.push(this.encodeUint64(message.timestamp));

    // Path (length + entries)
    parts.push(this.encodePath(message.path));

    // Origin public key (X25519 + ML-KEM)
    parts.push(this.encodeHybridPublicKey(message.originPublicKey));

    // Encrypted payload
    parts.push(this.encodeEncryptedPayload(message.encryptedPayload));

    return this.concatenateArrays(parts);
  }

  /**
   * Encodes a RESPONSE message to binary format.
   *
   * Requirement 6.2, 6.6
   */
  encodeResponse(message: ResponseMessage): Uint8Array {
    const parts: Uint8Array[] = [];

    // Header byte: type (bits 0-1) + attestation flag (bit 2)
    const header = MessageType.RESPONSE | (message.attestation ? 0x04 : 0);
    parts.push(new Uint8Array([header]));

    // Message ID (16 bytes)
    parts.push(this.encodeUUID(message.messageId));

    // Origin peer ID (length-prefixed)
    parts.push(this.encodeLengthPrefixedString(message.originPeerId));

    // Target peer ID (length-prefixed)
    parts.push(this.encodeLengthPrefixedString(message.targetPeerId));

    // Path
    parts.push(this.encodePath(message.path));

    // Success flag (1 byte)
    parts.push(new Uint8Array([message.success ? 1 : 0]));

    // Error message (if success is false)
    if (!message.success && message.errorMessage) {
      parts.push(this.encodeLengthPrefixedString(message.errorMessage));
    } else if (!message.success) {
      // Empty error message
      parts.push(new Uint8Array([0, 0]));
    }

    // Encrypted payload
    parts.push(this.encodeEncryptedPayload(message.encryptedPayload));

    // Attestation (if present)
    if (message.attestation) {
      parts.push(this.encodeAttestation(message.attestation));
    }

    return this.concatenateArrays(parts);
  }

  /**
   * Encodes a DUPLICATE message to binary format.
   *
   * Requirement 6.3, 6.6
   */
  encodeDuplicate(messageId: string): Uint8Array {
    const parts: Uint8Array[] = [];

    // Header byte
    parts.push(new Uint8Array([MessageType.DUPLICATE]));

    // Message ID (16 bytes)
    parts.push(this.encodeUUID(messageId));

    return this.concatenateArrays(parts);
  }

  /**
   * Encodes an UNREACHABLE message to binary format.
   *
   * Requirement 6.4, 6.6
   */
  encodeUnreachable(messageId: string, reason: UnreachableReason): Uint8Array {
    const parts: Uint8Array[] = [];

    // Header byte
    parts.push(new Uint8Array([MessageType.UNREACHABLE]));

    // Message ID (16 bytes)
    parts.push(this.encodeUUID(messageId));

    // Reason (1 byte)
    parts.push(new Uint8Array([reason]));

    return this.concatenateArrays(parts);
  }


  /**
   * Decodes a binary message to an OverlayMessage.
   *
   * Requirement 6.5, 6.6
   */
  decode(data: Uint8Array): OverlayMessage {
    if (data.length < 1) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        'Message too short: missing header'
      );
    }

    const header = data[0];
    const messageType = header & 0x03;
    const hasAttestation = (header & 0x04) !== 0;

    switch (messageType) {
      case MessageType.REQUEST:
        return this.decodeRequest(data, hasAttestation);
      case MessageType.RESPONSE:
        return this.decodeResponse(data, hasAttestation);
      case MessageType.DUPLICATE:
        return this.decodeDuplicate(data);
      case MessageType.UNREACHABLE:
        return this.decodeUnreachable(data);
      default:
        throw new OverlayError(
          OverlayErrorCode.INVALID_MESSAGE,
          `Unknown message type: ${messageType}`
        );
    }
  }

  /**
   * Validates message size against maximum allowed.
   *
   * Requirement 6.5
   */
  validateSize(data: Uint8Array, maxSize: number): boolean {
    return data.length <= maxSize;
  }

  // ============================================================================
  // Private encoding helpers
  // ============================================================================

  private encodeUUID(uuid: string): Uint8Array {
    // Convert UUID string to 16 bytes
    const hex = uuid.replace(/-/g, '');
    if (hex.length !== 32) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        `Invalid UUID format: ${uuid}`
      );
    }
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  private decodeUUID(data: Uint8Array, offset: number): { uuid: string; newOffset: number } {
    if (offset + 16 > data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        'Message too short: missing UUID'
      );
    }
    const bytes = data.slice(offset, offset + 16);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    return { uuid, newOffset: offset + 16 };
  }

  private encodeLengthPrefixedString(str: string): Uint8Array {
    const encoded = this.textEncoder.encode(str);
    const result = new Uint8Array(2 + encoded.length);
    // 2-byte length prefix (big-endian)
    result[0] = (encoded.length >> 8) & 0xff;
    result[1] = encoded.length & 0xff;
    result.set(encoded, 2);
    return result;
  }

  private decodeLengthPrefixedString(
    data: Uint8Array,
    offset: number
  ): { str: string; newOffset: number } {
    if (offset + 2 > data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        'Message too short: missing string length'
      );
    }
    const length = (data[offset] << 8) | data[offset + 1];
    if (offset + 2 + length > data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        `Message too short: expected ${length} bytes for string`
      );
    }
    const str = this.textDecoder.decode(data.slice(offset + 2, offset + 2 + length));
    return { str, newOffset: offset + 2 + length };
  }

  private encodeUint64(value: number): Uint8Array {
    const result = new Uint8Array(8);
    // Big-endian encoding
    const high = Math.floor(value / 0x100000000);
    const low = value >>> 0;
    result[0] = (high >> 24) & 0xff;
    result[1] = (high >> 16) & 0xff;
    result[2] = (high >> 8) & 0xff;
    result[3] = high & 0xff;
    result[4] = (low >> 24) & 0xff;
    result[5] = (low >> 16) & 0xff;
    result[6] = (low >> 8) & 0xff;
    result[7] = low & 0xff;
    return result;
  }

  private decodeUint64(data: Uint8Array, offset: number): { value: number; newOffset: number } {
    if (offset + 8 > data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        'Message too short: missing uint64'
      );
    }
    const high =
      (data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3];
    const low =
      (data[offset + 4] << 24) |
      (data[offset + 5] << 16) |
      (data[offset + 6] << 8) |
      data[offset + 7];
    const value = high * 0x100000000 + (low >>> 0);
    return { value, newOffset: offset + 8 };
  }

  private encodePath(path: string[]): Uint8Array {
    const parts: Uint8Array[] = [];
    // Path length (1 byte)
    parts.push(new Uint8Array([path.length]));
    // Each path entry (length-prefixed)
    for (const peerId of path) {
      parts.push(this.encodeLengthPrefixedString(peerId));
    }
    return this.concatenateArrays(parts);
  }

  private decodePath(data: Uint8Array, offset: number): { path: string[]; newOffset: number } {
    if (offset >= data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        'Message too short: missing path length'
      );
    }
    const pathLength = data[offset];
    offset++;
    const path: string[] = [];
    for (let i = 0; i < pathLength; i++) {
      const { str, newOffset } = this.decodeLengthPrefixedString(data, offset);
      path.push(str);
      offset = newOffset;
    }
    return { path, newOffset: offset };
  }

  private encodeHybridPublicKey(key: HybridPublicKey): Uint8Array {
    const result = new Uint8Array(
      CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE + CRYPTO_CONSTANTS.MLKEM768_PUBLIC_KEY_SIZE
    );
    result.set(key.x25519, 0);
    result.set(key.mlkem768, CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE);
    return result;
  }

  private decodeHybridPublicKey(
    data: Uint8Array,
    offset: number
  ): { key: HybridPublicKey; newOffset: number } {
    const totalSize =
      CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE + CRYPTO_CONSTANTS.MLKEM768_PUBLIC_KEY_SIZE;
    if (offset + totalSize > data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        'Message too short: missing hybrid public key'
      );
    }
    const key: HybridPublicKey = {
      x25519: data.slice(offset, offset + CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE),
      mlkem768: data.slice(
        offset + CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE,
        offset + totalSize
      ),
    };
    return { key, newOffset: offset + totalSize };
  }


  private encodeEncryptedPayload(payload: EncryptedPayload): Uint8Array {
    const parts: Uint8Array[] = [];

    // Ephemeral X25519 public key (32 bytes)
    parts.push(payload.ephemeralX25519);

    // ML-KEM ciphertext (1088 bytes)
    parts.push(payload.mlkemCiphertext);

    // Nonce (12 bytes)
    parts.push(payload.nonce);

    // Ciphertext length (4 bytes, big-endian)
    const ciphertextLength = new Uint8Array(4);
    ciphertextLength[0] = (payload.ciphertext.length >> 24) & 0xff;
    ciphertextLength[1] = (payload.ciphertext.length >> 16) & 0xff;
    ciphertextLength[2] = (payload.ciphertext.length >> 8) & 0xff;
    ciphertextLength[3] = payload.ciphertext.length & 0xff;
    parts.push(ciphertextLength);

    // Ciphertext (variable)
    parts.push(payload.ciphertext);

    // Auth tag (16 bytes)
    parts.push(payload.authTag);

    return this.concatenateArrays(parts);
  }

  private decodeEncryptedPayload(
    data: Uint8Array,
    offset: number
  ): { payload: EncryptedPayload; newOffset: number } {
    // Ephemeral X25519 (32 bytes)
    if (offset + CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE > data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        'Message too short: missing ephemeral X25519 key'
      );
    }
    const ephemeralX25519 = data.slice(
      offset,
      offset + CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE
    );
    offset += CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE;

    // ML-KEM ciphertext (1088 bytes)
    if (offset + CRYPTO_CONSTANTS.MLKEM768_CIPHERTEXT_SIZE > data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        'Message too short: missing ML-KEM ciphertext'
      );
    }
    const mlkemCiphertext = data.slice(
      offset,
      offset + CRYPTO_CONSTANTS.MLKEM768_CIPHERTEXT_SIZE
    );
    offset += CRYPTO_CONSTANTS.MLKEM768_CIPHERTEXT_SIZE;

    // Nonce (12 bytes)
    if (offset + CRYPTO_CONSTANTS.AES_GCM_NONCE_SIZE > data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        'Message too short: missing nonce'
      );
    }
    const nonce = data.slice(offset, offset + CRYPTO_CONSTANTS.AES_GCM_NONCE_SIZE);
    offset += CRYPTO_CONSTANTS.AES_GCM_NONCE_SIZE;

    // Ciphertext length (4 bytes)
    if (offset + 4 > data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        'Message too short: missing ciphertext length'
      );
    }
    const ciphertextLength =
      (data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3];
    offset += 4;

    // Ciphertext (variable)
    if (offset + ciphertextLength > data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        `Message too short: expected ${ciphertextLength} bytes for ciphertext`
      );
    }
    const ciphertext = data.slice(offset, offset + ciphertextLength);
    offset += ciphertextLength;

    // Auth tag (16 bytes)
    if (offset + CRYPTO_CONSTANTS.AES_GCM_TAG_SIZE > data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        'Message too short: missing auth tag'
      );
    }
    const authTag = data.slice(offset, offset + CRYPTO_CONSTANTS.AES_GCM_TAG_SIZE);
    offset += CRYPTO_CONSTANTS.AES_GCM_TAG_SIZE;

    return {
      payload: { ephemeralX25519, mlkemCiphertext, nonce, ciphertext, authTag },
      newOffset: offset,
    };
  }

  private encodeAttestation(attestation: NodeAttestation): Uint8Array {
    const parts: Uint8Array[] = [];

    // Peer ID
    parts.push(this.encodeLengthPrefixedString(attestation.peerId));

    // Handler code hash
    parts.push(this.encodeLengthPrefixedString(attestation.handlerCodeHash));

    // Timestamp (8 bytes)
    parts.push(this.encodeUint64(attestation.timestamp));

    // Signature (length-prefixed)
    const sigLength = new Uint8Array(2);
    sigLength[0] = (attestation.signature.length >> 8) & 0xff;
    sigLength[1] = attestation.signature.length & 0xff;
    parts.push(sigLength);
    parts.push(attestation.signature);

    // TEE type (1 byte: 0=none, 1=sgx, 2=nitro, 3=sev)
    let teeTypeByte = 0;
    if (attestation.teeType === 'sgx') teeTypeByte = 1;
    else if (attestation.teeType === 'nitro') teeTypeByte = 2;
    else if (attestation.teeType === 'sev') teeTypeByte = 3;
    parts.push(new Uint8Array([teeTypeByte]));

    // TEE attestation (length-prefixed, if present)
    if (attestation.teeAttestation) {
      const teeLength = new Uint8Array(2);
      teeLength[0] = (attestation.teeAttestation.length >> 8) & 0xff;
      teeLength[1] = attestation.teeAttestation.length & 0xff;
      parts.push(teeLength);
      parts.push(attestation.teeAttestation);
    } else {
      parts.push(new Uint8Array([0, 0]));
    }

    // Calculate total length and prepend
    const content = this.concatenateArrays(parts);
    const result = new Uint8Array(2 + content.length);
    result[0] = (content.length >> 8) & 0xff;
    result[1] = content.length & 0xff;
    result.set(content, 2);

    return result;
  }

  private decodeAttestation(
    data: Uint8Array,
    offset: number
  ): { attestation: NodeAttestation; newOffset: number } {
    // Attestation length (2 bytes)
    if (offset + 2 > data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        'Message too short: missing attestation length'
      );
    }
    const attestationLength = (data[offset] << 8) | data[offset + 1];
    offset += 2;

    if (offset + attestationLength > data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        `Message too short: expected ${attestationLength} bytes for attestation`
      );
    }

    // Peer ID
    const { str: peerId, newOffset: offset1 } = this.decodeLengthPrefixedString(data, offset);

    // Handler code hash
    const { str: handlerCodeHash, newOffset: offset2 } = this.decodeLengthPrefixedString(
      data,
      offset1
    );

    // Timestamp
    const { value: timestamp, newOffset: offset3 } = this.decodeUint64(data, offset2);

    // Signature
    if (offset3 + 2 > data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        'Message too short: missing signature length'
      );
    }
    const sigLength = (data[offset3] << 8) | data[offset3 + 1];
    if (offset3 + 2 + sigLength > data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        `Message too short: expected ${sigLength} bytes for signature`
      );
    }
    const signature = data.slice(offset3 + 2, offset3 + 2 + sigLength);
    let currentOffset = offset3 + 2 + sigLength;

    // TEE type
    if (currentOffset >= data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        'Message too short: missing TEE type'
      );
    }
    const teeTypeByte = data[currentOffset];
    currentOffset++;

    let teeType: 'sgx' | 'nitro' | 'sev' | undefined;
    if (teeTypeByte === 1) teeType = 'sgx';
    else if (teeTypeByte === 2) teeType = 'nitro';
    else if (teeTypeByte === 3) teeType = 'sev';

    // TEE attestation
    if (currentOffset + 2 > data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        'Message too short: missing TEE attestation length'
      );
    }
    const teeLength = (data[currentOffset] << 8) | data[currentOffset + 1];
    currentOffset += 2;

    let teeAttestation: Uint8Array | undefined;
    if (teeLength > 0) {
      if (currentOffset + teeLength > data.length) {
        throw new OverlayError(
          OverlayErrorCode.INVALID_MESSAGE,
          `Message too short: expected ${teeLength} bytes for TEE attestation`
        );
      }
      teeAttestation = data.slice(currentOffset, currentOffset + teeLength);
      currentOffset += teeLength;
    }

    return {
      attestation: {
        peerId,
        handlerCodeHash,
        timestamp,
        signature,
        teeType,
        teeAttestation,
      },
      newOffset: currentOffset,
    };
  }


  // ============================================================================
  // Private decoding methods for each message type
  // ============================================================================

  private decodeRequest(data: Uint8Array, requestAttestation: boolean): RequestMessage {
    let offset = 1; // Skip header

    // Message ID
    const { uuid: messageId, newOffset: offset1 } = this.decodeUUID(data, offset);

    // Origin peer ID
    const { str: originPeerId, newOffset: offset2 } = this.decodeLengthPrefixedString(
      data,
      offset1
    );

    // Target peer ID
    const { str: targetPeerId, newOffset: offset3 } = this.decodeLengthPrefixedString(
      data,
      offset2
    );

    // TTL
    if (offset3 >= data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        'Message too short: missing TTL'
      );
    }
    const ttl = data[offset3];

    // Timestamp
    const { value: timestamp, newOffset: offset4 } = this.decodeUint64(data, offset3 + 1);

    // Path
    const { path, newOffset: offset5 } = this.decodePath(data, offset4);

    // Origin public key
    const { key: originPublicKey, newOffset: offset6 } = this.decodeHybridPublicKey(
      data,
      offset5
    );

    // Encrypted payload
    const { payload: encryptedPayload } = this.decodeEncryptedPayload(data, offset6);

    return {
      type: MessageType.REQUEST,
      messageId,
      originPeerId,
      targetPeerId,
      ttl,
      timestamp,
      path,
      originPublicKey,
      encryptedPayload,
      requestAttestation: requestAttestation || undefined,
    };
  }

  private decodeResponse(data: Uint8Array, hasAttestation: boolean): ResponseMessage {
    let offset = 1; // Skip header

    // Message ID
    const { uuid: messageId, newOffset: offset1 } = this.decodeUUID(data, offset);

    // Origin peer ID
    const { str: originPeerId, newOffset: offset2 } = this.decodeLengthPrefixedString(
      data,
      offset1
    );

    // Target peer ID
    const { str: targetPeerId, newOffset: offset3 } = this.decodeLengthPrefixedString(
      data,
      offset2
    );

    // Path
    const { path, newOffset: offset4 } = this.decodePath(data, offset3);

    // Success flag
    if (offset4 >= data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        'Message too short: missing success flag'
      );
    }
    const success = data[offset4] === 1;
    let currentOffset = offset4 + 1;

    // Error message (if success is false)
    let errorMessage: string | undefined;
    if (!success) {
      const { str, newOffset } = this.decodeLengthPrefixedString(data, currentOffset);
      errorMessage = str || undefined;
      currentOffset = newOffset;
    }

    // Encrypted payload
    const { payload: encryptedPayload, newOffset: offset5 } = this.decodeEncryptedPayload(
      data,
      currentOffset
    );
    currentOffset = offset5;

    // Attestation (if present)
    let attestation: NodeAttestation | undefined;
    if (hasAttestation && currentOffset < data.length) {
      const result = this.decodeAttestation(data, currentOffset);
      attestation = result.attestation;
    }

    return {
      type: MessageType.RESPONSE,
      messageId,
      originPeerId,
      targetPeerId,
      path,
      encryptedPayload,
      success,
      errorMessage,
      attestation,
    };
  }

  private decodeDuplicate(data: Uint8Array): DuplicateMessage {
    // Message ID
    const { uuid: messageId } = this.decodeUUID(data, 1);

    return {
      type: MessageType.DUPLICATE,
      messageId,
    };
  }

  private decodeUnreachable(data: Uint8Array): UnreachableMessage {
    // Message ID
    const { uuid: messageId, newOffset } = this.decodeUUID(data, 1);

    // Reason
    if (newOffset >= data.length) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        'Message too short: missing unreachable reason'
      );
    }
    const reason = data[newOffset] as UnreachableReason;

    return {
      type: MessageType.UNREACHABLE,
      messageId,
      reason,
    };
  }

  // ============================================================================
  // Utility methods
  // ============================================================================

  private concatenateArrays(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }
}

/**
 * Singleton instance for convenience
 */
export const wireProtocol = new WireProtocol();
