/**
 * Attestation Module for Overlay Messaging Network
 *
 * Provides optional code attestation verification for secure messaging.
 * When enabled, nodes can verify that target nodes are running trusted code
 * before sending sensitive messages.
 *
 * Requirements: 11.1, 11.6, 11.7
 */

import type {
  NodeAttestation,
  AttestationResult,
  AttestationVerifier,
} from './types.js';

// Re-export types for convenience
export type { NodeAttestation, AttestationResult, AttestationVerifier };

/**
 * No-op attestation verifier that accepts all attestations.
 *
 * This is the default implementation used when attestation is disabled.
 * It always returns valid=true and trusts all code hashes.
 *
 * Requirement 11.7: Operate without attestation checks when not configured
 * Requirement 11.1: Support registering an AttestationVerifier
 */
export class NoOpAttestationVerifier implements AttestationVerifier {
  /**
   * Verify a node's attestation.
   * Always returns valid=true since this is a no-op implementation.
   *
   * @param _attestation - The attestation to verify (ignored)
   * @returns Always returns { valid: true }
   */
  async verify(_attestation: NodeAttestation): Promise<AttestationResult> {
    return { valid: true };
  }

  /**
   * Check if a code hash is trusted.
   * Always returns true since this is a no-op implementation.
   *
   * @param _hash - The code hash to check (ignored)
   * @returns Always returns true
   */
  isTrustedCodeHash(_hash: string): boolean {
    return true;
  }

  /**
   * Add a trusted code hash.
   * No-op since this implementation trusts all hashes.
   *
   * @param _hash - The code hash to add (ignored)
   */
  addTrustedCodeHash(_hash: string): void {
    // No-op: this implementation trusts all hashes
  }

  /**
   * Remove a trusted code hash.
   * No-op since this implementation trusts all hashes.
   *
   * @param _hash - The code hash to remove (ignored)
   */
  removeTrustedCodeHash(_hash: string): void {
    // No-op: this implementation trusts all hashes
  }
}


/**
 * Attestation verifier that maintains a set of trusted code hashes.
 *
 * This implementation validates attestations by checking:
 * 1. The attestation has a valid structure
 * 2. The handler code hash is in the trusted set
 * 3. The timestamp is recent (within a configurable window)
 *
 * Requirement 11.1: Support registering an AttestationVerifier
 * Requirement 11.4: Validate that target's code hash matches expected values
 * Requirement 11.6: Extensible attestation interface for future TEE support
 */
export class TrustedHashAttestationVerifier implements AttestationVerifier {
  private readonly trustedHashes: Set<string> = new Set();
  private readonly maxAgeMs: number;

  /**
   * Create a new TrustedHashAttestationVerifier.
   *
   * @param options - Configuration options
   * @param options.trustedHashes - Initial set of trusted code hashes
   * @param options.maxAgeMs - Maximum age of attestation in ms (default: 5 minutes)
   */
  constructor(options?: { trustedHashes?: string[]; maxAgeMs?: number }) {
    if (options?.trustedHashes) {
      for (const hash of options.trustedHashes) {
        this.trustedHashes.add(hash);
      }
    }
    this.maxAgeMs = options?.maxAgeMs ?? 300000; // 5 minutes default
  }

  /**
   * Verify a node's attestation.
   *
   * Checks:
   * 1. Attestation structure is valid
   * 2. Code hash is in trusted set
   * 3. Timestamp is recent
   *
   * @param attestation - The attestation to verify
   * @returns Verification result with validity and reason
   */
  async verify(attestation: NodeAttestation): Promise<AttestationResult> {
    // Check attestation structure
    if (!attestation.peerId || !attestation.handlerCodeHash) {
      return {
        valid: false,
        reason: 'Invalid attestation structure: missing required fields',
        trustedCode: false,
      };
    }

    // Check if code hash is trusted
    const trustedCode = this.isTrustedCodeHash(attestation.handlerCodeHash);
    if (!trustedCode) {
      return {
        valid: false,
        reason: `Code hash ${attestation.handlerCodeHash} is not in trusted set`,
        trustedCode: false,
      };
    }

    // Check timestamp freshness
    const now = Date.now();
    const age = now - attestation.timestamp;
    if (age > this.maxAgeMs) {
      return {
        valid: false,
        reason: `Attestation is too old: ${age}ms > ${this.maxAgeMs}ms`,
        trustedCode: true,
      };
    }

    if (attestation.timestamp > now + 60000) {
      // Allow 1 minute clock skew
      return {
        valid: false,
        reason: 'Attestation timestamp is in the future',
        trustedCode: true,
      };
    }

    // Note: Signature verification would be done here in production
    // For now, we trust the attestation if the code hash is trusted

    return {
      valid: true,
      trustedCode: true,
    };
  }

  /**
   * Check if a code hash is in the trusted set.
   *
   * @param hash - The code hash to check
   * @returns True if the hash is trusted
   */
  isTrustedCodeHash(hash: string): boolean {
    return this.trustedHashes.has(hash);
  }

  /**
   * Add a code hash to the trusted set.
   *
   * @param hash - The code hash to add
   */
  addTrustedCodeHash(hash: string): void {
    this.trustedHashes.add(hash);
  }

  /**
   * Remove a code hash from the trusted set.
   *
   * @param hash - The code hash to remove
   */
  removeTrustedCodeHash(hash: string): void {
    this.trustedHashes.delete(hash);
  }

  /**
   * Get the number of trusted hashes.
   *
   * @returns The count of trusted hashes
   */
  getTrustedHashCount(): number {
    return this.trustedHashes.size;
  }

  /**
   * Get all trusted hashes.
   *
   * @returns Array of trusted code hashes
   */
  getTrustedHashes(): string[] {
    return Array.from(this.trustedHashes);
  }

  /**
   * Clear all trusted hashes.
   */
  clearTrustedHashes(): void {
    this.trustedHashes.clear();
  }
}

/**
 * Create a default attestation verifier based on configuration.
 *
 * @param enabled - Whether attestation is enabled
 * @param trustedHashes - Optional initial trusted hashes
 * @returns An appropriate attestation verifier
 */
export function createAttestationVerifier(
  enabled: boolean,
  trustedHashes?: string[]
): AttestationVerifier {
  if (!enabled) {
    return new NoOpAttestationVerifier();
  }
  return new TrustedHashAttestationVerifier({ trustedHashes });
}
