/**
 * Fast-check generators for DHT testing
 *
 * Provides reusable arbitraries for generating:
 * - Peer IDs (byte arrays representing cryptographic identifiers)
 * - Uint8Arrays of various sizes
 * - Valid DHT node configurations
 *
 * Requirements: 7.1, 7.2
 */
import * as fc from 'fast-check';
import type { DHTNodeConfig, TurnServer, WebRTCConfig, CircuitRelayConfig } from '../dht/config.js';
/**
 * Generate a Uint8Array of specified length range
 * Useful for keys, values, and peer ID bytes
 */
export declare function uint8ArrayArbitrary(options?: {
    minLength?: number;
    maxLength?: number;
}): fc.Arbitrary<Uint8Array>;
/**
 * Generate a peer ID as a Uint8Array
 * Peer IDs in libp2p are typically 32-byte (256-bit) cryptographic hashes
 */
export declare function peerIdArbitrary(options?: {
    length?: number;
}): fc.Arbitrary<Uint8Array>;
/**
 * Generate a valid multiaddr-like listen address string
 */
export declare const listenAddressArbitrary: fc.Arbitrary<string>;
/**
 * Generate a valid bootstrap peer multiaddr string
 */
export declare const bootstrapPeerArbitrary: fc.Arbitrary<string>;
/**
 * Generate a valid STUN server URL
 */
export declare const stunServerArbitrary: fc.Arbitrary<string>;
/**
 * Generate a valid TURN server configuration
 */
export declare const turnServerArbitrary: fc.Arbitrary<TurnServer>;
/**
 * Generate a valid WebRTC configuration
 */
export declare const webrtcConfigArbitrary: fc.Arbitrary<WebRTCConfig>;
/**
 * Generate a valid circuit relay configuration
 */
export declare const circuitRelayConfigArbitrary: fc.Arbitrary<CircuitRelayConfig>;
/**
 * Generate a valid DHT protocol string
 */
export declare const protocolArbitrary: fc.Arbitrary<string>;
/**
 * Generate a valid DHTNodeConfig object
 * All generated configs pass validation
 */
export declare const configArbitrary: fc.Arbitrary<DHTNodeConfig>;
/**
 * Generate a minimal valid DHTNodeConfig (only required fields)
 */
export declare const minimalConfigArbitrary: fc.Arbitrary<DHTNodeConfig>;
/**
 * Generate a DHT key (typically 32 bytes for content addressing)
 */
export declare function dhtKeyArbitrary(options?: {
    length?: number;
}): fc.Arbitrary<Uint8Array>;
/**
 * Generate a DHT value (variable length content)
 */
export declare function dhtValueArbitrary(options?: {
    minLength?: number;
    maxLength?: number;
}): fc.Arbitrary<Uint8Array>;
/**
 * Generate a key-value pair for DHT storage
 */
export declare const keyValuePairArbitrary: fc.Arbitrary<{
    key: Uint8Array;
    value: Uint8Array;
}>;
/**
 * Generate an array of peer IDs (useful for testing routing operations)
 */
export declare function peerIdArrayArbitrary(options?: {
    minLength?: number;
    maxLength?: number;
    peerIdLength?: number;
}): fc.Arbitrary<Uint8Array[]>;
//# sourceMappingURL=generators.d.ts.map