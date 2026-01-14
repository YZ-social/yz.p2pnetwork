/**
 * Custom Multiaddr Protocol Registration
 * 
 * This module registers custom multiaddr protocols that are used in this project
 * but are not part of the standard multiaddr specification.
 * 
 * The `http-path` protocol is used for nginx path-based routing, allowing
 * multiple libp2p nodes to share a single public endpoint with different paths.
 * 
 * IMPORTANT: This module must be imported BEFORE any multiaddr parsing occurs.
 * Import it at the top of browser-node.ts and any other entry points.
 * 
 * Protocol: http-path
 * - Code: 0x1F0 (496) - chosen to avoid conflicts with standard protocols
 * - Size: V (variable length, prefixed with varint)
 * - Purpose: Specifies the URL path for nginx routing
 * 
 * Example addresses:
 * - /dns4/example.com/tcp/443/wss/http-path/libp2p/p2p/{peerId}
 * - /dns4/example.com/tcp/443/wss/http-path/dht%2Fnode-1/p2p/{peerId}
 */

import { registry, V } from '@multiformats/multiaddr';
import type { ProtocolCodec } from '@multiformats/multiaddr';

// Protocol code for http-path (must not conflict with standard protocols)
// Using 0x1F0 (496) which is in the user-defined range
const HTTP_PATH_CODE = 0x1F0;

// Track if we've already registered
let httpPathRegistered = false;

/**
 * Register the http-path protocol with the multiaddr library
 * 
 * This allows multiaddrs containing http-path to be parsed without errors.
 * The protocol is variable-length (V) to support arbitrary path strings.
 */
export function registerHttpPathProtocol(): void {
  if (httpPathRegistered) {
    return;
  }

  try {
    const protocol: ProtocolCodec = {
      code: HTTP_PATH_CODE,
      name: 'http-path',
      size: V, // Variable length
    };

    registry.addProtocol(protocol);
    httpPathRegistered = true;
    console.log('[Multiaddr] Registered http-path protocol (code: 0x1F0)');
  } catch (error) {
    // Protocol might already be registered
    if (error instanceof Error && error.message.includes('already')) {
      httpPathRegistered = true;
      console.log('[Multiaddr] http-path protocol already registered');
    } else {
      console.warn('[Multiaddr] Failed to register http-path protocol:', error);
    }
  }
}

/**
 * Check if http-path protocol is registered
 */
export function isHttpPathRegistered(): boolean {
  return httpPathRegistered;
}

// Auto-register on module load
registerHttpPathProtocol();
