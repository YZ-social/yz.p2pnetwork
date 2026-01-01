/**
 * Property-based tests for Hybrid Post-Quantum Encryption
 *
 * Feature: overlay-messaging
 *
 * Tests the correctness properties of the HybridCrypto class using
 * property-based testing with fast-check.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fc from 'fast-check';
import { HybridCrypto } from './crypto.js';
import type { HybridKeyPair } from './types.js';

// Shared crypto instance
const crypto = new HybridCrypto();

// Pre-generated key pairs for testing (generated once to speed up tests)
let recipientKeyPair: HybridKeyPair;

beforeAll(async () => {
  // Generate a key pair once for all tests
  recipientKeyPair = await crypto.generateKeyPair();
});

/**
 * Arbitrary for generating valid plaintext payloads
 * Supports empty to reasonably large payloads
 */
const plaintextArbitrary = fc.uint8Array({ minLength: 0, maxLength: 10000 });

/**
 * Feature: overlay-messaging, Property 1: Encryption Round-Trip
 *
 * *For any* valid plaintext payload, encrypting with a recipient's hybrid
 * public key then decrypting with the corresponding private key produces
 * the original plaintext.
 *
 * **Validates: Requirements 9.1, 9.3, 9.4, 9.5, 9.7, 9.10**
 */
describe('Property 1: Encryption Round-Trip', () => {
  it('encrypt then decrypt produces original plaintext for any valid payload', async () => {
    await fc.assert(
      fc.asyncProperty(plaintextArbitrary, async (plaintext) => {
        // Encrypt the plaintext with recipient's public key
        const encrypted = await crypto.encrypt(plaintext, recipientKeyPair.publicKey);

        // Decrypt with recipient's private key
        const decrypted = await crypto.decrypt(encrypted, recipientKeyPair.privateKey);

        // Verify round-trip produces original plaintext
        expect(decrypted).toEqual(plaintext);
      }),
      { numRuns: 100 }
    );
  });

  it('round-trip works with freshly generated key pairs', async () => {
    await fc.assert(
      fc.asyncProperty(plaintextArbitrary, async (plaintext) => {
        // Generate a fresh key pair for this test
        const freshKeyPair = await crypto.generateKeyPair();

        // Encrypt with fresh public key
        const encrypted = await crypto.encrypt(plaintext, freshKeyPair.publicKey);

        // Decrypt with fresh private key
        const decrypted = await crypto.decrypt(encrypted, freshKeyPair.privateKey);

        // Verify round-trip
        expect(decrypted).toEqual(plaintext);
      }),
      { numRuns: 50 } // Fewer runs since key generation is expensive
    );
  });
});


/**
 * Feature: overlay-messaging, Property 4: Ephemeral Keys Are Unique Per Message
 *
 * *For any* two messages sent to the same target, the ephemeral X25519
 * public keys in the encrypted payloads are different.
 *
 * **Validates: Requirements 9.2**
 */
describe('Property 4: Ephemeral Keys Are Unique Per Message', () => {
  it('two encryptions of the same plaintext produce different ephemeral keys', async () => {
    await fc.assert(
      fc.asyncProperty(plaintextArbitrary, async (plaintext) => {
        // Encrypt the same plaintext twice
        const encrypted1 = await crypto.encrypt(plaintext, recipientKeyPair.publicKey);
        const encrypted2 = await crypto.encrypt(plaintext, recipientKeyPair.publicKey);

        // Ephemeral X25519 keys should be different
        expect(encrypted1.ephemeralX25519).not.toEqual(encrypted2.ephemeralX25519);
      }),
      { numRuns: 100 }
    );
  });

  it('multiple encryptions produce unique ephemeral keys', async () => {
    const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
    const ephemeralKeys: Uint8Array[] = [];

    // Encrypt multiple times and collect ephemeral keys
    for (let i = 0; i < 20; i++) {
      const encrypted = await crypto.encrypt(plaintext, recipientKeyPair.publicKey);
      ephemeralKeys.push(encrypted.ephemeralX25519);
    }

    // All ephemeral keys should be unique
    const keyStrings = ephemeralKeys.map((k) => Buffer.from(k).toString('hex'));
    const uniqueKeys = new Set(keyStrings);
    expect(uniqueKeys.size).toBe(ephemeralKeys.length);
  });

  it('ephemeral keys are different even for different plaintexts', async () => {
    await fc.assert(
      fc.asyncProperty(
        plaintextArbitrary,
        plaintextArbitrary,
        async (plaintext1, plaintext2) => {
          const encrypted1 = await crypto.encrypt(plaintext1, recipientKeyPair.publicKey);
          const encrypted2 = await crypto.encrypt(plaintext2, recipientKeyPair.publicKey);

          // Ephemeral keys should always be different regardless of plaintext
          expect(encrypted1.ephemeralX25519).not.toEqual(encrypted2.ephemeralX25519);
        }
      ),
      { numRuns: 100 }
    );
  });
});
