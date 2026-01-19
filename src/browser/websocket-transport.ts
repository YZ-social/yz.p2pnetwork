/**
 * Custom WebSocket Transport for Browser Nodes
 * 
 * This module provides a WebSocket transport that supports the http-path
 * multiaddr component, which is needed for path-based routing through nginx.
 * 
 * The standard @libp2p/websockets transport:
 * 1. Filters out multiaddrs with http-path (dialFilter doesn't recognize it)
 * 2. Uses multiaddrToUri which doesn't know how to convert http-path to a URL
 * 
 * This custom transport:
 * 1. Accepts multiaddrs with http-path in dialFilter
 * 2. Intercepts dial calls to construct the correct WebSocket URL with path
 * 
 * Requirements: 1.5
 */

import { webSockets } from '@libp2p/websockets';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import type { Transport, Connection } from '@libp2p/interface';
import { logger } from '@libp2p/logger';
import { AbstractMultiaddrConnection } from '@libp2p/utils';
import { multiaddr, type Multiaddr } from '@multiformats/multiaddr';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';

// Create a logger using @libp2p/logger - this creates a proper Logger with newScope
const log = logger('libp2p:websocket:http-path');

/**
 * Check if a multiaddr contains WebSocket protocols
 * 
 * This is a more permissive check than the standard multiaddr-matcher
 * that allows http-path and other extensions.
 */
function isWebSocketMultiaddr(ma: Multiaddr): boolean {
  const str = ma.toString();
  // Check for /ws/ or /wss/ patterns, but exclude WebRTC addresses
  // WebRTC addresses contain /webrtc/ and should be handled by the WebRTC transport
  if (str.includes('/webrtc/') || str.includes('/webrtc-direct/')) {
    return false;
  }
  return str.includes('/ws/') || str.includes('/wss/') || 
         str.endsWith('/ws') || str.endsWith('/wss');
}

/**
 * Check if a multiaddr contains http-path component
 */
function hasHttpPath(ma: Multiaddr): boolean {
  return ma.toString().includes('/http-path/');
}

/**
 * Extract the http-path value from a multiaddr and return a clean multiaddr
 * 
 * Example:
 * Input:  /dns4/example.com/tcp/443/wss/http-path/dht%2Fnode-1/p2p/12D3...
 * Output: { cleanMultiaddr: /dns4/example.com/tcp/443/wss/p2p/12D3..., path: /dht/node-1 }
 */
function extractHttpPath(ma: Multiaddr): { cleanMultiaddr: Multiaddr; path: string | null } {
  const str = ma.toString();
  
  // Match http-path component: /http-path/{encoded-path}
  const httpPathMatch = str.match(/\/http-path\/([^/]+)/);
  
  if (!httpPathMatch) {
    return { cleanMultiaddr: ma, path: null };
  }
  
  // Decode the path (e.g., dht%2Fnode-1 -> dht/node-1)
  const encodedPath = httpPathMatch[1];
  const decodedPath = decodeURIComponent(encodedPath);
  
  // Remove the http-path component from the multiaddr
  const cleanStr = str.replace(/\/http-path\/[^/]+/, '');
  
  return {
    cleanMultiaddr: multiaddr(cleanStr),
    path: '/' + decodedPath,
  };
}

/**
 * Convert a multiaddr with http-path to a WebSocket URL
 * 
 * Example:
 * Input:  /dns4/example.com/tcp/443/wss/http-path/dht%2Fnode-1/p2p/12D3...
 * Output: wss://example.com/dht/node-1
 */
function multiaddrWithHttpPathToUrl(ma: Multiaddr): string | null {
  const str = ma.toString();
  
  // Extract components
  const dnsMatch = str.match(/\/dns4\/([^/]+)/);
  const ipMatch = str.match(/\/ip4\/([^/]+)/);
  const tcpMatch = str.match(/\/tcp\/(\d+)/);
  const httpPathMatch = str.match(/\/http-path\/([^/]+)/);
  const isWss = str.includes('/wss');
  const isWs = str.includes('/ws');
  
  const host = dnsMatch?.[1] || ipMatch?.[1];
  const port = tcpMatch?.[1];
  
  if (!host) {
    return null;
  }
  
  const protocol = isWss ? 'wss' : (isWs ? 'ws' : null);
  if (!protocol) {
    return null;
  }
  
  // Decode the path from http-path
  let path = '/';
  if (httpPathMatch) {
    path = '/' + decodeURIComponent(httpPathMatch[1]);
  }
  
  // Default ports
  const defaultPort = protocol === 'wss' ? '443' : '80';
  const portStr = port && port !== defaultPort ? `:${port}` : '';
  
  return `${protocol}://${host}${portStr}${path}`;
}

/**
 * Create a WebSocket transport with http-path support
 * 
 * This transport:
 * 1. Accepts multiaddrs with http-path component in dialFilter
 * 2. Intercepts dial calls to handle http-path conversion
 * 
 * For multiaddrs with http-path, it constructs the WebSocket URL
 * with the path from the http-path component.
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
    
    // Override dial to handle http-path by creating WebSocket with correct URL
    const originalDial = transport.dial.bind(transport);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transport.dial = async (ma: Multiaddr, options?: any): Promise<Connection> => {
      if (hasHttpPath(ma)) {
        // For http-path multiaddrs, we need to dial with the correct URL
        const wsUrl = multiaddrWithHttpPathToUrl(ma);
        const { cleanMultiaddr, path } = extractHttpPath(ma);
        
        console.log(`[WebSocket] Dialing with http-path:`);
        console.log(`[WebSocket]   Original: ${ma.toString()}`);
        console.log(`[WebSocket]   Clean: ${cleanMultiaddr.toString()}`);
        console.log(`[WebSocket]   Path: ${path}`);
        console.log(`[WebSocket]   URL: ${wsUrl}`);
        
        // The base transport will convert cleanMultiaddr to a URL without the path
        // We need to manually create the WebSocket with the correct URL
        // Since we can't easily inject the URL, we'll use a workaround:
        // Create the WebSocket ourselves and wrap it
        
        if (wsUrl) {
          try {
            // Create WebSocket connection with the correct URL (including path)
            const connection = await dialWebSocketWithPath(ma, wsUrl, options, components);
            return connection;
          } catch (err) {
            console.error(`[WebSocket] Failed to dial with http-path:`, err);
            // Fall back to base transport (might fail, but worth trying)
          }
        }
        
        // Fall back to clean multiaddr (without http-path)
        return originalDial(cleanMultiaddr, options);
      }
      
      return originalDial(ma, options);
    };
    
    return transport;
  };
}

/**
 * Dial a WebSocket connection with a specific URL path
 * 
 * This creates a WebSocket connection using the URL with path,
 * then wraps it in a libp2p Connection.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function dialWebSocketWithPath(
  originalMa: Multiaddr,
  wsUrl: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components: any
): Promise<Connection> {
  return new Promise((resolve, reject) => {
    console.log(`[WebSocket] Creating WebSocket to: ${wsUrl}`);
    
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`WebSocket connection timeout to ${wsUrl}`));
    }, options?.signal?.timeout || 30000);
    
    ws.onopen = async () => {
      clearTimeout(timeout);
      console.log(`[WebSocket] Connected to: ${wsUrl}`);
      
      try {
        // Create a maConn (MultiaddrConnection) from the WebSocket
        console.log('[WebSocket] Creating maConn...');
        const maConn = createMaConnFromWebSocket(ws, originalMa);
        console.log('[WebSocket] maConn created, log type:', typeof maConn.log);
        console.log('[WebSocket] maConn.log.newScope type:', typeof maConn.log?.newScope);
        
        // Upgrade the connection using libp2p's upgrader
        const upgrader = components.upgrader;
        if (!upgrader) {
          throw new Error('No upgrader available');
        }
        
        console.log('[WebSocket] Calling upgrader.upgradeOutbound...');
        const connection = await upgrader.upgradeOutbound(maConn, options);
        console.log('[WebSocket] Upgrade successful!');
        resolve(connection);
      } catch (err) {
        // AbortError is expected when libp2p cancels redundant dial attempts
        // Only log non-abort errors as they indicate real problems
        const isAbortError = err instanceof Error && 
          (err.name === 'AbortError' || err.message.includes('aborted'));
        if (!isAbortError) {
          console.error('[WebSocket] Error during upgrade:', err);
        }
        ws.close();
        reject(err);
      }
    };
    
    ws.onerror = (event) => {
      clearTimeout(timeout);
      console.error(`[WebSocket] Error connecting to ${wsUrl}:`, event);
      reject(new Error(`WebSocket error connecting to ${wsUrl}`));
    };
    
    ws.onclose = (event) => {
      clearTimeout(timeout);
      if (!event.wasClean) {
        reject(new Error(`WebSocket closed unexpectedly: ${event.code} ${event.reason}`));
      }
    };
  });
}

/**
 * WebSocket MultiaddrConnection that extends AbstractMultiaddrConnection
 * 
 * This properly implements the Stream interface that libp2p's upgrader expects.
 */
class WebSocketMultiaddrConnection extends AbstractMultiaddrConnection {
  private websocket: WebSocket;

  constructor(init: {
    websocket: WebSocket;
    remoteAddr: Multiaddr;
    logger: ReturnType<typeof logger>;
  }) {
    super({
      remoteAddr: init.remoteAddr,
      log: init.logger,
      direction: 'outbound',
    });
    
    this.websocket = init.websocket;
    
    // Handle WebSocket close
    this.websocket.addEventListener('close', (evt) => {
      this.log('closed - code %d, reason "%s", wasClean %s', evt.code, evt.reason, evt.wasClean);
      if (!evt.wasClean) {
        this.onRemoteReset();
        return;
      }
      this.onTransportClosed();
    }, { once: true });
    
    // Handle incoming messages
    this.websocket.addEventListener('message', (evt) => {
      try {
        let buf: Uint8Array;
        if (typeof evt.data === 'string') {
          buf = uint8ArrayFromString(evt.data);
        } else if (evt.data instanceof ArrayBuffer) {
          buf = new Uint8Array(evt.data, 0, evt.data.byteLength);
        } else {
          this.abort(new Error('Incorrect binary type'));
          return;
        }
        this.onData(buf);
      } catch (err) {
        this.log.error('error receiving data - %e', err);
      }
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendData(data: any): { sentBytes: number; canSendMore: boolean } {
    // Handle Uint8ArrayList by iterating
    if (typeof data[Symbol.iterator] === 'function' && !(data instanceof Uint8Array)) {
      for (const buf of data) {
        this.websocket.send(buf);
      }
    } else {
      this.websocket.send(data);
    }
    
    const maxBufferedAmount = 1024 * 1024 * 4; // 4MB
    const canSendMore = this.websocket.bufferedAmount < maxBufferedAmount;
    
    return {
      sentBytes: data.byteLength,
      canSendMore,
    };
  }

  sendReset(): void {
    this.websocket.close(1006); // abnormal closure
  }

  async sendClose(): Promise<void> {
    this.websocket.close();
  }

  sendPause(): void {
    // read backpressure is not supported
  }

  sendResume(): void {
    // read backpressure is not supported
  }
}

/**
 * Create a MultiaddrConnection from a WebSocket using AbstractMultiaddrConnection
 */
function createMaConnFromWebSocket(ws: WebSocket, remoteAddr: Multiaddr): WebSocketMultiaddrConnection {
  // Create a fresh logger for this connection
  const connLog = logger('libp2p:websocket:maconn');
  
  // Debug: log what the logger looks like
  console.log('[WebSocket] Logger created:', typeof connLog);
  console.log('[WebSocket] Logger.newScope:', typeof connLog.newScope);
  console.log('[WebSocket] Logger keys:', Object.keys(connLog));
  
  return new WebSocketMultiaddrConnection({
    websocket: ws,
    remoteAddr,
    logger: connLog,
  });
}


/**
 * Create a circuit relay transport with http-path support
 * 
 * The standard circuit relay transport's dialFilter doesn't recognize
 * multiaddrs with http-path component. This wrapper overrides the dialFilter
 * to accept circuit relay addresses that contain http-path.
 * 
 * Example address that needs to be accepted:
 * /dns4/imeyouwe.com/tcp/443/wss/http-path/libp2p/p2p/12D3.../p2p-circuit/p2p/12D3...
 * 
 * @returns A circuit relay transport factory function
 */
export function circuitRelayTransportWithHttpPath(): ReturnType<typeof circuitRelayTransport> {
  const baseTransport = circuitRelayTransport();
  
  return (components) => {
    const transport = baseTransport(components) as Transport;
    
    // Override the dialFilter to accept http-path multiaddrs
    const originalDialFilter = transport.dialFilter?.bind(transport);
    transport.dialFilter = (multiaddrs: Multiaddr[]): Multiaddr[] => {
      // First try the original filter
      const standardMatches = originalDialFilter ? originalDialFilter(multiaddrs) : [];
      
      // Then add any circuit relay multiaddrs that weren't matched (e.g., with http-path)
      const additionalMatches = multiaddrs.filter(ma => {
        // Skip if already matched by standard filter
        if (standardMatches.some(m => m.toString() === ma.toString())) {
          return false;
        }
        // Check if it's a circuit relay multiaddr (contains /p2p-circuit/)
        const str = ma.toString();
        return str.includes('/p2p-circuit/');
      });
      
      if (additionalMatches.length > 0) {
        console.log('[CircuitRelay] dialFilter accepting http-path addresses:', additionalMatches.map(m => m.toString()));
      }
      
      return [...standardMatches, ...additionalMatches];
    };
    
    return transport;
  };
}
