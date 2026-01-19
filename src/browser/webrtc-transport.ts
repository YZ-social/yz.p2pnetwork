/**
 * Custom WebRTC Transport for Browser Nodes
 * 
 * This module provides a WebRTC transport that properly handles circuit relay
 * addresses containing the http-path multiaddr component.
 * 
 * The standard @libp2p/webrtc transport's listener doesn't recognize circuit
 * relay addresses with http-path, so it produces 0 WebRTC addresses. This
 * custom transport wrapper fixes that by:
 * 
 * 1. Monitoring for circuit relay addresses (even with http-path)
 * 2. Generating proper WebRTC addresses by inserting /webrtc/ before /p2p/{peerId}
 * 
 * WebRTC Address Format:
 * - Circuit relay: /.../p2p/{relayPeerId}/p2p-circuit/p2p/{browserPeerId}
 * - WebRTC:        /.../p2p/{relayPeerId}/p2p-circuit/webrtc/p2p/{browserPeerId}
 * 
 * The /webrtc/ component tells libp2p to use the circuit relay as a signaling
 * channel to exchange SDP offers/answers, then establish a direct WebRTC connection.
 * 
 * Requirements: Browser-to-browser WebRTC connectivity
 */

import { webRTC } from '@libp2p/webrtc';
import type { Multiaddr } from '@multiformats/multiaddr';
import { multiaddr } from '@multiformats/multiaddr';

/**
 * Debug logging control - set to true to enable verbose logging
 */
const DEBUG_WEBRTC = true;

/**
 * Log only when DEBUG_WEBRTC is enabled
 */
function debugLog(...args: unknown[]): void {
  if (DEBUG_WEBRTC) {
    console.log(...args);
  }
}

/**
 * Configuration for the WebRTC transport
 */
export interface WebRTCWithHttpPathConfig {
  rtcConfiguration?: RTCConfiguration;
}

/**
 * Check if a multiaddr is a circuit relay address
 */
function isCircuitRelayAddress(ma: Multiaddr): boolean {
  const str = ma.toString();
  return str.includes('/p2p-circuit');
}

/**
 * Check if a multiaddr already has the /webrtc/ component
 */
function hasWebRTCComponent(ma: Multiaddr): boolean {
  const str = ma.toString();
  return str.includes('/webrtc/') || str.includes('/webrtc-direct/');
}

/**
 * Convert a circuit relay address to a WebRTC address
 * 
 * Input:  /.../p2p/{relayPeerId}/p2p-circuit/p2p/{browserPeerId}
 * Output: /.../p2p/{relayPeerId}/p2p-circuit/webrtc/p2p/{browserPeerId}
 */
function toWebRTCAddress(circuitRelayAddr: Multiaddr): Multiaddr | null {
  const str = circuitRelayAddr.toString();
  
  // Check if it's a circuit relay address ending with /p2p/{peerId}
  const match = str.match(/^(.+\/p2p-circuit)(\/p2p\/[^/]+)$/);
  if (!match) {
    return null;
  }
  
  // Insert /webrtc/ between /p2p-circuit and /p2p/{peerId}
  const webrtcAddrStr = `${match[1]}/webrtc${match[2]}`;
  
  try {
    return multiaddr(webrtcAddrStr);
  } catch {
    console.warn(`[WebRTC] Failed to create WebRTC multiaddr from: ${webrtcAddrStr}`);
    return null;
  }
}

/**
 * Store for libp2p address getter - set during transport initialization
 */
let libp2pAddressGetter: (() => Multiaddr[]) | null = null;

/**
 * Direct storage for circuit relay addresses
 * This is populated when relay:created-reservation events fire
 * and provides a reliable source of relay addresses for WebRTC address generation
 */
const storedRelayAddresses: Multiaddr[] = [];

/**
 * Set the libp2p address getter function
 * This should be called after libp2p is created but before starting
 * 
 * IMPORTANT: This getter should return addresses from the address manager,
 * NOT from libp2p.getMultiaddrs() to avoid circular dependency.
 */
export function setLibp2pAddressGetter(getter: () => Multiaddr[]): void {
  libp2pAddressGetter = getter;
  console.log('[WebRTC] Address getter registered');
}

/**
 * Add a circuit relay address to the stored addresses
 * This should be called when a relay reservation is created
 * 
 * @param addr - The circuit relay address (as string or Multiaddr)
 */
export function addRelayAddress(addr: string | Multiaddr): void {
  const ma = typeof addr === 'string' ? multiaddr(addr) : addr;
  const addrStr = ma.toString();
  
  // Check if already stored
  if (storedRelayAddresses.some(a => a.toString() === addrStr)) {
    debugLog(`[WebRTC] Relay address already stored: ${addrStr}`);
    return;
  }
  
  storedRelayAddresses.push(ma);
  console.log(`[WebRTC] ✅ Stored relay address: ${addrStr}`);
  console.log(`[WebRTC] Total stored relay addresses: ${storedRelayAddresses.length}`);
}

/**
 * Remove a circuit relay address from the stored addresses
 * This should be called when a relay reservation is removed
 * 
 * @param addr - The circuit relay address to remove (as string or Multiaddr)
 */
export function removeRelayAddress(addr: string | Multiaddr): void {
  const addrStr = typeof addr === 'string' ? addr : addr.toString();
  const index = storedRelayAddresses.findIndex(a => a.toString() === addrStr);
  if (index !== -1) {
    storedRelayAddresses.splice(index, 1);
    console.log(`[WebRTC] Removed relay address: ${addrStr}`);
  }
}

/**
 * Clear all stored relay addresses
 * This should be called when the node stops
 */
export function clearRelayAddresses(): void {
  storedRelayAddresses.length = 0;
  debugLog('[WebRTC] Cleared all stored relay addresses');
}

/**
 * Get all stored relay addresses
 */
export function getStoredRelayAddresses(): Multiaddr[] {
  return [...storedRelayAddresses];
}

/**
 * Generate WebRTC addresses from current circuit relay addresses
 * 
 * This function is called by the WebRTC listener's getAddrs() to generate
 * WebRTC addresses from circuit relay addresses. It filters for circuit
 * relay addresses and converts them to WebRTC addresses.
 * 
 * Address sources (in order of priority):
 * 1. Stored relay addresses (from relay:created-reservation events)
 * 2. Addresses from the libp2p address getter (fallback)
 */
export function getWebRTCAddresses(): Multiaddr[] {
  const webrtcAddrs: Multiaddr[] = [];
  
  // First, use stored relay addresses (most reliable source)
  if (storedRelayAddresses.length > 0) {
    debugLog(`[WebRTC] getWebRTCAddresses using ${storedRelayAddresses.length} stored relay addresses`);
    
    for (const addr of storedRelayAddresses) {
      const addrStr = addr.toString();
      
      // Skip if already has /webrtc/
      if (hasWebRTCComponent(addr)) {
        debugLog(`[WebRTC] Stored address already has /webrtc/, using as-is: ${addrStr}`);
        webrtcAddrs.push(addr);
        continue;
      }
      
      // Convert to WebRTC address
      const webrtcAddr = toWebRTCAddress(addr);
      if (webrtcAddr) {
        debugLog(`[WebRTC] Converted stored relay to WebRTC: ${webrtcAddr.toString()}`);
        webrtcAddrs.push(webrtcAddr);
      }
    }
    
    if (webrtcAddrs.length > 0) {
      return webrtcAddrs;
    }
  }
  
  // Fallback: try the address getter
  if (!libp2pAddressGetter) {
    debugLog('[WebRTC] No address getter registered and no stored addresses');
    return [];
  }
  
  const libp2pAddrs = libp2pAddressGetter();
  debugLog(`[WebRTC] getWebRTCAddresses fallback - checking ${libp2pAddrs.length} addresses from getter`);
  
  for (const addr of libp2pAddrs) {
    const addrStr = addr.toString();
    
    // Skip if not a circuit relay address
    if (!isCircuitRelayAddress(addr)) {
      continue;
    }
    
    debugLog(`[WebRTC] Found circuit relay address: ${addrStr}`);
    
    // Skip if already has /webrtc/
    if (hasWebRTCComponent(addr)) {
      debugLog(`[WebRTC] Address already has /webrtc/, using as-is`);
      webrtcAddrs.push(addr);
      continue;
    }
    
    // Convert to WebRTC address
    const webrtcAddr = toWebRTCAddress(addr);
    if (webrtcAddr) {
      debugLog(`[WebRTC] Converted to WebRTC address: ${webrtcAddr.toString()}`);
      webrtcAddrs.push(webrtcAddr);
    }
  }
  
  return webrtcAddrs;
}

/**
 * Create a WebRTC transport with support for http-path in circuit relay addresses
 * 
 * This transport wrapper ensures that WebRTC addresses are properly generated
 * even when circuit relay addresses contain the http-path component.
 * 
 * The approach here is to wrap the base transport and override its dialFilter
 * to accept WebRTC addresses with http-path. The listener address generation
 * is handled separately via getWebRTCAddresses().
 * 
 * @param config - WebRTC configuration options
 * @returns A WebRTC transport factory function
 */
export function webRTCWithHttpPath(config?: WebRTCWithHttpPathConfig): ReturnType<typeof webRTC> {
  const baseTransportFactory = webRTC(config);
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (components: any): any => {
    const transport = baseTransportFactory(components);
    
    console.log('[WebRTC] Creating WebRTC transport with http-path support');
    
    // Store original dialFilter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalDialFilter = (transport as any).dialFilter?.bind(transport);
    
    // Override dialFilter to accept WebRTC addresses with http-path
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (transport as any).dialFilter = (multiaddrs: any[]): any[] => {
      debugLog(`[WebRTC] dialFilter called with ${multiaddrs.length} addresses`);
      
      // Get standard matches from base transport
      const standardMatches = originalDialFilter ? originalDialFilter(multiaddrs) : [];
      debugLog(`[WebRTC] Base dialFilter matched ${standardMatches.length} addresses`);
      
      // Also accept WebRTC addresses with http-path that weren't matched
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const additionalMatches = multiaddrs.filter((ma: any) => {
        const str = ma.toString();
        // Skip if already in standard matches
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (standardMatches.some((m: any) => m.toString() === str)) {
          return false;
        }
        // Accept if it has /webrtc/ and /p2p-circuit/ (WebRTC over relay)
        if (str.includes('/webrtc/') && str.includes('/p2p-circuit')) {
          debugLog(`[WebRTC] Accepting WebRTC-over-relay address: ${str}`);
          return true;
        }
        // Accept if it has /webrtc/ and http-path (direct WebRTC with path routing)
        if (str.includes('/webrtc/') && str.includes('/http-path/')) {
          debugLog(`[WebRTC] Accepting WebRTC with http-path address: ${str}`);
          return true;
        }
        return false;
      });
      
      const result = [...standardMatches, ...additionalMatches];
      debugLog(`[WebRTC] dialFilter returning ${result.length} addresses (${standardMatches.length} standard + ${additionalMatches.length} additional)`);
      
      return result;
    };
    
    // Wrap createListener to log WebRTC address generation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalCreateListener = (transport as any).createListener.bind(transport);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (transport as any).createListener = (options: any) => {
      debugLog('[WebRTC] Creating WebRTC listener');
      const listener = originalCreateListener(options);
      
      // Wrap getAddrs to include generated WebRTC addresses
      const originalGetAddrs = listener.getAddrs.bind(listener);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      listener.getAddrs = (): any[] => {
        const baseAddrs = originalGetAddrs();
        debugLog(`[WebRTC] listener.getAddrs() - base listener has ${baseAddrs.length} addresses`);
        
        // If base listener has addresses, use them
        if (baseAddrs.length > 0) {
          return baseAddrs;
        }
        
        // Otherwise, generate WebRTC addresses from circuit relay addresses
        const webrtcAddrs = getWebRTCAddresses();
        debugLog(`[WebRTC] listener.getAddrs() - generated ${webrtcAddrs.length} WebRTC addresses`);
        
        return webrtcAddrs;
      };
      
      return listener;
    };
    
    return transport;
  };
}
