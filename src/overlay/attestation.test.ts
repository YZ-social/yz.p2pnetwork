/**
 * Unit tests for Attestation Module
 *
 * Tests the attestation verifier implementations:
 * - NoOpAttestationVerifier (default, accepts all)
 * - TrustedHashAttestationVerifier (validates code hashes)
 * - createAttestationVerifier factory function
 *
 * Requirements: 11.1, 11.7
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  NoOpAttestationVerifier,
  TrustedHashAttestationVerifier,
  createAttestationVerifier,
} from './attestation.js';
import type { NodeAttestation } from './types.js';

// Helper to create a valid attestation
function createTestAttestation(overrides?: Partial<NodeAttestation>): NodeAttestation {
  return {
    peerId: 'QmTestPeerId12345678901234567890123456789012345',
    handlerCodeHash: 'abc123def456789012345678901234567890123456789012345678901234',
    timestamp: Date.now(),
    signature: new Uint8Array(64),
    ...overrides,
  };
}

describe('NoOpAttestationVerifier', () => {
  let verifier: NoOpAttestationVerifier;

  beforeEach(() => {
    verifier = new NoOpAttestationVerifier();
  });

  describe('verify', () => {
    it('should always return valid=true', async () => {
      const attestation = createTestAttestation();
      const result = await verifier.verify(attestation);

      expect(result.valid).toBe(true);
    });

    it('should return valid=true even for empty attestation', async () => {
      const attestation = createTestAttestation({
        peerId: '',
        handlerCodeHash: '',
      });
      const result = await verifier.verify(attestation);

      expect(result.valid).toBe(true);
    });

    it('should return valid=true for any attestation', async () => {
      const attestations = [
        createTestAttestation({ handlerCodeHash: 'hash1' }),
        createTestAttestation({ handlerCodeHash: 'hash2' }),
        createTestAttestation({ timestamp: 0 }),
        createTestAttestation({ timestamp: Date.now() + 1000000 }),
      ];

      for (const attestation of attestations) {
        const result = await verifier.verify(attestation);
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('isTrustedCodeHash', () => {
    it('should always return true', () => {
      expect(verifier.isTrustedCodeHash('any-hash')).toBe(true);
      expect(verifier.isTrustedCodeHash('')).toBe(true);
      expect(verifier.isTrustedCodeHash('abc123')).toBe(true);
    });
  });

  describe('addTrustedCodeHash', () => {
    it('should be a no-op', () => {
      // Should not throw
      expect(() => verifier.addTrustedCodeHash('hash1')).not.toThrow();
      // Still returns true for any hash
      expect(verifier.isTrustedCodeHash('hash1')).toBe(true);
      expect(verifier.isTrustedCodeHash('other-hash')).toBe(true);
    });
  });

  describe('removeTrustedCodeHash', () => {
    it('should be a no-op', () => {
      // Should not throw
      expect(() => verifier.removeTrustedCodeHash('hash1')).not.toThrow();
      // Still returns true for any hash
      expect(verifier.isTrustedCodeHash('hash1')).toBe(true);
    });
  });
});


describe('TrustedHashAttestationVerifier', () => {
  describe('constructor', () => {
    it('should create with empty trusted hashes by default', () => {
      const verifier = new TrustedHashAttestationVerifier();
      expect(verifier.getTrustedHashCount()).toBe(0);
    });

    it('should create with initial trusted hashes', () => {
      const verifier = new TrustedHashAttestationVerifier({
        trustedHashes: ['hash1', 'hash2', 'hash3'],
      });
      expect(verifier.getTrustedHashCount()).toBe(3);
      expect(verifier.isTrustedCodeHash('hash1')).toBe(true);
      expect(verifier.isTrustedCodeHash('hash2')).toBe(true);
      expect(verifier.isTrustedCodeHash('hash3')).toBe(true);
    });

    it('should use default maxAgeMs of 5 minutes', async () => {
      const verifier = new TrustedHashAttestationVerifier({
        trustedHashes: ['hash1'],
      });

      // Attestation from 6 minutes ago should be invalid
      const oldAttestation = createTestAttestation({
        handlerCodeHash: 'hash1',
        timestamp: Date.now() - 360000, // 6 minutes ago
      });
      const result = await verifier.verify(oldAttestation);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('too old');
    });

    it('should use custom maxAgeMs', async () => {
      const verifier = new TrustedHashAttestationVerifier({
        trustedHashes: ['hash1'],
        maxAgeMs: 60000, // 1 minute
      });

      // Attestation from 2 minutes ago should be invalid
      const oldAttestation = createTestAttestation({
        handlerCodeHash: 'hash1',
        timestamp: Date.now() - 120000, // 2 minutes ago
      });
      const result = await verifier.verify(oldAttestation);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('too old');
    });
  });

  describe('verify', () => {
    let verifier: TrustedHashAttestationVerifier;

    beforeEach(() => {
      verifier = new TrustedHashAttestationVerifier({
        trustedHashes: ['trusted-hash-1', 'trusted-hash-2'],
      });
    });

    it('should return valid=true for trusted hash with recent timestamp', async () => {
      const attestation = createTestAttestation({
        handlerCodeHash: 'trusted-hash-1',
        timestamp: Date.now(),
      });
      const result = await verifier.verify(attestation);

      expect(result.valid).toBe(true);
      expect(result.trustedCode).toBe(true);
    });

    it('should return valid=false for untrusted hash', async () => {
      const attestation = createTestAttestation({
        handlerCodeHash: 'untrusted-hash',
        timestamp: Date.now(),
      });
      const result = await verifier.verify(attestation);

      expect(result.valid).toBe(false);
      expect(result.trustedCode).toBe(false);
      expect(result.reason).toContain('not in trusted set');
    });

    it('should return valid=false for missing peerId', async () => {
      const attestation = createTestAttestation({
        peerId: '',
        handlerCodeHash: 'trusted-hash-1',
      });
      const result = await verifier.verify(attestation);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('missing required fields');
    });

    it('should return valid=false for missing handlerCodeHash', async () => {
      const attestation = createTestAttestation({
        handlerCodeHash: '',
      });
      const result = await verifier.verify(attestation);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('missing required fields');
    });

    it('should return valid=false for old attestation', async () => {
      const attestation = createTestAttestation({
        handlerCodeHash: 'trusted-hash-1',
        timestamp: Date.now() - 600000, // 10 minutes ago
      });
      const result = await verifier.verify(attestation);

      expect(result.valid).toBe(false);
      expect(result.trustedCode).toBe(true); // Code is trusted, but attestation is old
      expect(result.reason).toContain('too old');
    });

    it('should return valid=false for future timestamp', async () => {
      const attestation = createTestAttestation({
        handlerCodeHash: 'trusted-hash-1',
        timestamp: Date.now() + 120000, // 2 minutes in future
      });
      const result = await verifier.verify(attestation);

      expect(result.valid).toBe(false);
      expect(result.trustedCode).toBe(true);
      expect(result.reason).toContain('in the future');
    });

    it('should allow small clock skew (1 minute)', async () => {
      const attestation = createTestAttestation({
        handlerCodeHash: 'trusted-hash-1',
        timestamp: Date.now() + 30000, // 30 seconds in future
      });
      const result = await verifier.verify(attestation);

      expect(result.valid).toBe(true);
    });
  });

  describe('isTrustedCodeHash', () => {
    it('should return true for trusted hashes', () => {
      const verifier = new TrustedHashAttestationVerifier({
        trustedHashes: ['hash1', 'hash2'],
      });

      expect(verifier.isTrustedCodeHash('hash1')).toBe(true);
      expect(verifier.isTrustedCodeHash('hash2')).toBe(true);
    });

    it('should return false for untrusted hashes', () => {
      const verifier = new TrustedHashAttestationVerifier({
        trustedHashes: ['hash1'],
      });

      expect(verifier.isTrustedCodeHash('hash2')).toBe(false);
      expect(verifier.isTrustedCodeHash('')).toBe(false);
    });
  });

  describe('addTrustedCodeHash', () => {
    it('should add a hash to the trusted set', () => {
      const verifier = new TrustedHashAttestationVerifier();

      expect(verifier.isTrustedCodeHash('new-hash')).toBe(false);
      verifier.addTrustedCodeHash('new-hash');
      expect(verifier.isTrustedCodeHash('new-hash')).toBe(true);
    });

    it('should handle duplicate additions', () => {
      const verifier = new TrustedHashAttestationVerifier();

      verifier.addTrustedCodeHash('hash1');
      verifier.addTrustedCodeHash('hash1');
      expect(verifier.getTrustedHashCount()).toBe(1);
    });
  });

  describe('removeTrustedCodeHash', () => {
    it('should remove a hash from the trusted set', () => {
      const verifier = new TrustedHashAttestationVerifier({
        trustedHashes: ['hash1', 'hash2'],
      });

      expect(verifier.isTrustedCodeHash('hash1')).toBe(true);
      verifier.removeTrustedCodeHash('hash1');
      expect(verifier.isTrustedCodeHash('hash1')).toBe(false);
      expect(verifier.getTrustedHashCount()).toBe(1);
    });

    it('should handle removing non-existent hash', () => {
      const verifier = new TrustedHashAttestationVerifier({
        trustedHashes: ['hash1'],
      });

      expect(() => verifier.removeTrustedCodeHash('non-existent')).not.toThrow();
      expect(verifier.getTrustedHashCount()).toBe(1);
    });
  });

  describe('getTrustedHashes', () => {
    it('should return all trusted hashes', () => {
      const verifier = new TrustedHashAttestationVerifier({
        trustedHashes: ['hash1', 'hash2', 'hash3'],
      });

      const hashes = verifier.getTrustedHashes();
      expect(hashes).toHaveLength(3);
      expect(hashes).toContain('hash1');
      expect(hashes).toContain('hash2');
      expect(hashes).toContain('hash3');
    });
  });

  describe('clearTrustedHashes', () => {
    it('should remove all trusted hashes', () => {
      const verifier = new TrustedHashAttestationVerifier({
        trustedHashes: ['hash1', 'hash2'],
      });

      expect(verifier.getTrustedHashCount()).toBe(2);
      verifier.clearTrustedHashes();
      expect(verifier.getTrustedHashCount()).toBe(0);
    });
  });
});


describe('createAttestationVerifier', () => {
  it('should return NoOpAttestationVerifier when disabled', () => {
    const verifier = createAttestationVerifier(false);
    expect(verifier).toBeInstanceOf(NoOpAttestationVerifier);
  });

  it('should return TrustedHashAttestationVerifier when enabled', () => {
    const verifier = createAttestationVerifier(true);
    expect(verifier).toBeInstanceOf(TrustedHashAttestationVerifier);
  });

  it('should initialize with trusted hashes when enabled', () => {
    const verifier = createAttestationVerifier(true, ['hash1', 'hash2']);
    expect(verifier.isTrustedCodeHash('hash1')).toBe(true);
    expect(verifier.isTrustedCodeHash('hash2')).toBe(true);
    expect(verifier.isTrustedCodeHash('hash3')).toBe(false);
  });

  it('should ignore trusted hashes when disabled', () => {
    const verifier = createAttestationVerifier(false, ['hash1', 'hash2']);
    // NoOpAttestationVerifier always returns true
    expect(verifier.isTrustedCodeHash('hash1')).toBe(true);
    expect(verifier.isTrustedCodeHash('any-hash')).toBe(true);
  });
});

describe('Attestation config handling in OverlayNetwork', () => {
  // These tests verify attestation config is properly handled
  // The actual OverlayNetwork tests are in overlay.test.ts

  it('should export attestation types', () => {
    // Verify types are exported correctly
    expect(NoOpAttestationVerifier).toBeDefined();
    expect(TrustedHashAttestationVerifier).toBeDefined();
    expect(createAttestationVerifier).toBeDefined();
  });
});
