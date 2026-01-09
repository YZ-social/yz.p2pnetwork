/**
 * Custom WebSocket Transport for Browser Nodes
 * 
 * This module provides a WebSocket transport that supports the http-path
 * multiaddr component, which is needed for path-based routing through nginx.
 * 
 * The standard @libp2p/websockets transport filters out multiaddrs with
 * http-path because the multiaddr-matcher doesn't recognize it. This custom
 * transport uses a more permissive filter that accepts any multiaddr containing
 * /ws or /wss protocols.
 * 
 * Requirements: 1.5
 */

import { webSockets } from '@libp2p/websockets';
import type { Transport } from '@libp2p/interface';
import type { Multiaddr } from '@multiformats/multiaddr';

/**
 * Check if a multiaddr contains WebSocket protocols
 * 
 * This is a more permissive check than the standard multiaddr-matcher
 * that allows http-path and other extensions.
 */
function isWebSocketMultiaddr(ma: Multiaddr): boolean {
  const str = ma.toString();
  // Check for /ws/ or /wss/ or /ws/http-path or /wss/http-path patterns
  return str.includes('/ws/') || str.includes('/wss/') || 
         str.endsWith('/ws') || str.endsWith('/wss');
}

/**
 * Create a WebSocket transport with permissive filtering
 * 
 * This transport accepts multiaddrs with http-path component,
 * which is needed for path-based WebSocket routing through nginx.
 * 
 * @returns A WebSocket transport factory function
 */
export function webSocketsWithHttpPath(): ReturnType<typeof webSockets> {
  const baseTransport = webSockets();
  
  return (components) => {
    const transport = baseTransport(components) as Transport;
    
    // Override the dialFilter to accept http-path multiaddrs
    const originalDialFilter = transport.dialFilter?.bind(transport);
    transport.dialFilter = (multiaddrs: Multiaddr[]): Multiaddr[] => {
      // First try the original filter
      const standardMatches = originalDialFilter ? originalDialFilter(multiaddrs) : [];
      
      // Then add any WebSocket multiaddrs that weren't matched (e.g., with http-path)
      const additionalMatches = multiaddrs.filter(ma => {
        // Skip if already matched by standard filter
        if (standardMatches.some(m => m.toString() === ma.toString())) {
          return false;
        }
        // Check if it's a WebSocket multiaddr
        return isWebSocketMultiaddr(ma);
      });
      
      return [...standardMatches, ...additionalMatches];
    };
    
    return transport;
  };
}
