/**
 * Hybrid Post-Quantum Encryption Module
 *
 * Implements hybrid encryption combining:
 * - X25519 (classical ECDH) for key exchange
 * - ML-KEM-768 (post-quantum KEM) for quantum resistance
 * - AES-256-GCM for symmetric encryption
 * - HKDF for key derivation
 *
 * Requirements: 9.1-9.10, 10.1, 10.2
 */

import { x25519 } from '@noble/curves/ed25519';
import { ml_kem768 } from '@noble/post-quantum/ml-kem';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/ciphers/utils.js';

import { CRYPTO_CONSTANTS } from './constants.js';
import { OverlayError, OverlayErrorCode } from './errors.js';
import type {
  HybridPublicKey,
  HybridPrivateKey,
  HybridKeyPair,
  EncryptedPayload,
} from './types.js';

/**
 * HybridCrypto provides hybrid post-quantum encryption/decryption.
 *
 * Requirements:
 * - 9.1: Encrypt payload using hybrid post-quantum encryption (X25519 + ML-KEM-768)
 * - 9.2: Use ephemeral key pairs for each message (forward secrecy)
 * - 9.3: Derive shared secret using both X25519 ECDH and ML-KEM-768 encapsulation
 * - 9.4: Combine classical and post-quantum secrets using HKDF
 * - 9.5: Encrypt payloads using AES-256-GCM
 * - 9.7: Decrypt payload using private keys
 * - 9.10: Round-trip property (encrypt then decrypt = original)
 * - 10.1: Generate hybrid key pair (X25519 + ML-KEM-768)
 * - 10.2: Store private keys securely (serialization support)
 */
export class HybridCrypto {
  /**
   * HKDF info string for key derivation
   */
  private static readonly HKDF_INFO = new TextEncoder().encode('overlay-hybrid-encryption-v1');

  /**
   * Generates a new hybrid key pair (X25519 + ML-KEM-768).
   *
   * Requirement 10.1: Generate hybrid key pair on node start
   *
   * @returns A new HybridKeyPair with public and private keys
   */
  async generateKeyPair(): Promise<HybridKeyPair> {
    // Generate X25519 key pair (classical)
    const x25519Private = randomBytes(CRYPTO_CONSTANTS.X25519_PRIVATE_KEY_SIZE);
    const x25519Public = x25519.getPublicKey(x25519Private);

    // Generate ML-KEM-768 key pair (post-quantum)
    const mlkemKeyPair = ml_kem768.keygen();

    return {
      publicKey: {
        x25519: x25519Public,
        mlkem768: mlkemKeyPair.publicKey,
      },
      privateKey: {
        x25519: x25519Private,
        mlkem768: mlkemKeyPair.secretKey,
      },
    };
  }


  /**
   * Serializes a hybrid public key to a single Uint8Array.
   *
   * Format: [x25519 (32 bytes)][mlkem768 (1184 bytes)]
   *
   * Requirement 10.2: Support key serialization for storage
   *
   * @param key The hybrid public key to serialize
   * @returns Serialized public key as Uint8Array
   */
  serializePublicKey(key: HybridPublicKey): Uint8Array {
    const totalSize =
      CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE +
      CRYPTO_CONSTANTS.MLKEM768_PUBLIC_KEY_SIZE;
    const result = new Uint8Array(totalSize);

    result.set(key.x25519, 0);
    result.set(key.mlkem768, CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE);

    return result;
  }

  /**
   * Deserializes a hybrid public key from a Uint8Array.
   *
   * Requirement 10.2: Support key deserialization for loading
   *
   * @param data Serialized public key data
   * @returns Deserialized HybridPublicKey
   * @throws OverlayError if data is invalid
   */
  deserializePublicKey(data: Uint8Array): HybridPublicKey {
    const expectedSize =
      CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE +
      CRYPTO_CONSTANTS.MLKEM768_PUBLIC_KEY_SIZE;

    if (data.length !== expectedSize) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        `Invalid public key size: expected ${expectedSize}, got ${data.length}`
      );
    }

    return {
      x25519: data.slice(0, CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE),
      mlkem768: data.slice(
        CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE,
        CRYPTO_CONSTANTS.X25519_PUBLIC_KEY_SIZE + CRYPTO_CONSTANTS.MLKEM768_PUBLIC_KEY_SIZE
      ),
    };
  }

  /**
   * Serializes a hybrid private key to a single Uint8Array.
   *
   * Format: [x25519 (32 bytes)][mlkem768 (2400 bytes)]
   *
   * Requirement 10.2: Support key serialization for secure storage
   *
   * @param key The hybrid private key to serialize
   * @returns Serialized private key as Uint8Array
   */
  serializePrivateKey(key: HybridPrivateKey): Uint8Array {
    const totalSize =
      CRYPTO_CONSTANTS.X25519_PRIVATE_KEY_SIZE +
      CRYPTO_CONSTANTS.MLKEM768_PRIVATE_KEY_SIZE;
    const result = new Uint8Array(totalSize);

    result.set(key.x25519, 0);
    result.set(key.mlkem768, CRYPTO_CONSTANTS.X25519_PRIVATE_KEY_SIZE);

    return result;
  }

  /**
   * Deserializes a hybrid private key from a Uint8Array.
   *
   * Requirement 10.2: Support key deserialization for loading
   *
   * @param data Serialized private key data
   * @returns Deserialized HybridPrivateKey
   * @throws OverlayError if data is invalid
   */
  deserializePrivateKey(data: Uint8Array): HybridPrivateKey {
    const expectedSize =
      CRYPTO_CONSTANTS.X25519_PRIVATE_KEY_SIZE +
      CRYPTO_CONSTANTS.MLKEM768_PRIVATE_KEY_SIZE;

    if (data.length !== expectedSize) {
      throw new OverlayError(
        OverlayErrorCode.INVALID_MESSAGE,
        `Invalid private key size: expected ${expectedSize}, got ${data.length}`
      );
    }

    return {
      x25519: data.slice(0, CRYPTO_CONSTANTS.X25519_PRIVATE_KEY_SIZE),
      mlkem768: data.slice(
        CRYPTO_CONSTANTS.X25519_PRIVATE_KEY_SIZE,
        CRYPTO_CONSTANTS.X25519_PRIVATE_KEY_SIZE + CRYPTO_CONSTANTS.MLKEM768_PRIVATE_KEY_SIZE
      ),
    };
  }


  /**
   * Encrypts a plaintext payload using hybrid post-quantum encryption.
   *
   * Process:
   * 1. Generate ephemeral X25519 key pair (Requirement 9.2)
   * 2. Perform X25519 ECDH with recipient's public key (Requirement 9.3)
   * 3. Perform ML-KEM-768 encapsulation (Requirement 9.3)
   * 4. Combine secrets using HKDF (Requirement 9.4)
   * 5. Encrypt payload with AES-256-GCM (Requirement 9.5)
   *
   * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
   *
   * @param plaintext The data to encrypt
   * @param recipientPublicKey The recipient's hybrid public key
   * @returns EncryptedPayload containing all data needed for decryption
   */
  async encrypt(
    plaintext: Uint8Array,
    recipientPublicKey: HybridPublicKey
  ): Promise<EncryptedPayload> {
    // Step 1: Generate ephemeral X25519 key pair (Requirement 9.2 - forward secrecy)
    const ephemeralX25519Private = randomBytes(CRYPTO_CONSTANTS.X25519_PRIVATE_KEY_SIZE);
    const ephemeralX25519Public = x25519.getPublicKey(ephemeralX25519Private);

    // Step 2: Perform X25519 ECDH (Requirement 9.3)
    const x25519SharedSecret = x25519.getSharedSecret(
      ephemeralX25519Private,
      recipientPublicKey.x25519
    );

    // Step 3: Perform ML-KEM-768 encapsulation (Requirement 9.3)
    const { cipherText: mlkemCiphertext, sharedSecret: mlkemSharedSecret } =
      ml_kem768.encapsulate(recipientPublicKey.mlkem768);

    // Step 4: Combine secrets using HKDF (Requirement 9.4)
    const combinedSecret = this.combineSecrets(x25519SharedSecret, mlkemSharedSecret);
    const aesKey = hkdf(sha256, combinedSecret, undefined, HybridCrypto.HKDF_INFO, CRYPTO_CONSTANTS.AES_KEY_SIZE);

    // Step 5: Generate nonce and encrypt with AES-256-GCM (Requirement 9.5)
    const nonce = randomBytes(CRYPTO_CONSTANTS.AES_GCM_NONCE_SIZE);
    const cipher = gcm(aesKey, nonce);
    const ciphertextWithTag = cipher.encrypt(plaintext);

    // Split ciphertext and auth tag
    const ciphertext = ciphertextWithTag.slice(0, ciphertextWithTag.length - CRYPTO_CONSTANTS.AES_GCM_TAG_SIZE);
    const authTag = ciphertextWithTag.slice(ciphertextWithTag.length - CRYPTO_CONSTANTS.AES_GCM_TAG_SIZE);

    return {
      ephemeralX25519: ephemeralX25519Public,
      mlkemCiphertext,
      nonce,
      ciphertext,
      authTag,
    };
  }

  /**
   * Decrypts an encrypted payload using the recipient's private keys.
   *
   * Process:
   * 1. Perform X25519 ECDH with ephemeral public key
   * 2. Perform ML-KEM-768 decapsulation
   * 3. Combine secrets using HKDF
   * 4. Decrypt payload with AES-256-GCM
   *
   * Requirement 9.7: Decrypt payload using private keys
   *
   * @param encrypted The encrypted payload
   * @param privateKey The recipient's hybrid private key
   * @returns Decrypted plaintext
   * @throws OverlayError if decryption fails
   */
  async decrypt(
    encrypted: EncryptedPayload,
    privateKey: HybridPrivateKey
  ): Promise<Uint8Array> {
    try {
      // Step 1: Perform X25519 ECDH with ephemeral public key
      const x25519SharedSecret = x25519.getSharedSecret(
        privateKey.x25519,
        encrypted.ephemeralX25519
      );

      // Step 2: Perform ML-KEM-768 decapsulation
      const mlkemSharedSecret = ml_kem768.decapsulate(
        encrypted.mlkemCiphertext,
        privateKey.mlkem768
      );

      // Step 3: Combine secrets using HKDF
      const combinedSecret = this.combineSecrets(x25519SharedSecret, mlkemSharedSecret);
      const aesKey = hkdf(sha256, combinedSecret, undefined, HybridCrypto.HKDF_INFO, CRYPTO_CONSTANTS.AES_KEY_SIZE);

      // Step 4: Decrypt with AES-256-GCM
      // Reconstruct ciphertext with auth tag for decryption
      const ciphertextWithTag = new Uint8Array(encrypted.ciphertext.length + encrypted.authTag.length);
      ciphertextWithTag.set(encrypted.ciphertext, 0);
      ciphertextWithTag.set(encrypted.authTag, encrypted.ciphertext.length);

      const cipher = gcm(aesKey, encrypted.nonce);
      return cipher.decrypt(ciphertextWithTag);
    } catch (error) {
      throw new OverlayError(
        OverlayErrorCode.DECRYPTION_FAILED,
        'Failed to decrypt payload',
        { cause: error instanceof Error ? error : undefined }
      );
    }
  }

  /**
   * Combines classical and post-quantum shared secrets.
   *
   * Requirement 9.4: Combine secrets using concatenation before HKDF
   *
   * @param classicalSecret X25519 shared secret
   * @param pqSecret ML-KEM shared secret
   * @returns Combined secret for HKDF input
   */
  private combineSecrets(classicalSecret: Uint8Array, pqSecret: Uint8Array): Uint8Array {
    const combined = new Uint8Array(classicalSecret.length + pqSecret.length);
    combined.set(classicalSecret, 0);
    combined.set(pqSecret, classicalSecret.length);
    return combined;
  }
}

/**
 * Singleton instance for convenience
 */
export const hybridCrypto = new HybridCrypto();
