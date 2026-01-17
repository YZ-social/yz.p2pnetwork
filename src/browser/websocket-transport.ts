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
import type { Transport, Connection } from '@libp2p/interface';
import { logger } from '@libp2p/logger';
import { multiaddr, type Multiaddr } from '@multiformats/multiaddr';

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
  // Check for /ws/ or /wss/ or /ws/http-path or /wss/http-path patterns
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
    log('Creating WebSocket to: %s', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`WebSocket connection timeout to ${wsUrl}`));
    }, options?.signal?.timeout || 30000);
    
    ws.onopen = async () => {
      clearTimeout(timeout);
      log('Connected to: %s', wsUrl);
      
      try {
        // Create a maConn (MultiaddrConnection) from the WebSocket
        const maConn = createMaConnFromWebSocket(ws, originalMa);
        
        // Upgrade the connection using libp2p's upgrader
        const upgrader = components.upgrader;
        if (!upgrader) {
          throw new Error('No upgrader available');
        }
        
        const connection = await upgrader.upgradeOutbound(maConn, options);
        resolve(connection);
      } catch (err) {
        ws.close();
        reject(err);
      }
    };
    
    ws.onerror = (event) => {
      clearTimeout(timeout);
      log.error('Error connecting to %s: %o', wsUrl, event);
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
 * Create a MultiaddrConnection from a WebSocket
 * 
 * This wraps a WebSocket in the interface that libp2p expects.
 * The MultiaddrConnection interface requires:
 * - source: AsyncIterable for incoming data
 * - sink: Function to send data
 * - remoteAddr: The remote multiaddr
 * - timeline: Connection timing info
 * - close/abort: Connection lifecycle methods
 * - log: Logger with newScope method (required by upgrader)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMaConnFromWebSocket(ws: WebSocket, remoteAddr: Multiaddr): any {
  let closed = false;
  const closePromise = new Promise<void>((resolve) => {
    ws.onclose = () => {
      closed = true;
      resolve();
    };
  });
  
  // Create async iterator for incoming data
  const messageQueue: Uint8Array[] = [];
  let messageResolve: ((value: IteratorResult<Uint8Array>) => void) | null = null;
  let done = false;
  
  ws.onmessage = (event) => {
    const data = new Uint8Array(event.data as ArrayBuffer);
    if (messageResolve) {
      messageResolve({ value: data, done: false });
      messageResolve = null;
    } else {
      messageQueue.push(data);
    }
  };
  
  ws.onclose = () => {
    done = true;
    closed = true;
    if (messageResolve) {
      messageResolve({ value: undefined as any, done: true });
      messageResolve = null;
    }
  };
  
  const source: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          if (messageQueue.length > 0) {
            return { value: messageQueue.shift()!, done: false };
          }
          if (done) {
            return { value: undefined as any, done: true };
          }
          return new Promise((resolve) => {
            messageResolve = resolve;
          });
        },
      };
    },
  };
  
  const sink = async (source: AsyncIterable<Uint8Array | Uint8Array[]>): Promise<void> => {
    for await (const chunk of source) {
      if (closed) break;
      
      // Handle both Uint8Array and Uint8Array[] (Uint8ArrayList)
      if (Array.isArray(chunk)) {
        for (const c of chunk) {
          ws.send(c);
        }
      } else if (chunk instanceof Uint8Array) {
        ws.send(chunk);
      } else {
        // Might be Uint8ArrayList - try to get subarray
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = chunk as any;
        if (typeof c.subarray === 'function') {
          ws.send(c.subarray());
        } else if (typeof c.slice === 'function') {
          ws.send(c.slice());
        }
      }
    }
  };
  
  // Create a fresh logger for this connection using @libp2p/logger
  // This ensures the logger has the newScope method that the upgrader requires
  const connLog = logger('libp2p:websocket:maconn');
  
  // Debug: log what the logger looks like
  console.log('[WebSocket] Logger created:', typeof connLog);
  console.log('[WebSocket] Logger.newScope:', typeof connLog.newScope);
  console.log('[WebSocket] Logger keys:', Object.keys(connLog));
  
  return {
    source,
    sink,
    remoteAddr,
    timeline: {
      open: Date.now(),
    },
    close: async () => {
      if (!closed) {
        ws.close();
        await closePromise;
      }
    },
    abort: (err?: Error) => {
      if (!closed) {
        connLog('Aborting connection:', err?.message);
        ws.close();
      }
    },
    // Use a fresh logger from @libp2p/logger - it has the proper newScope method
    log: connLog,
  };
}
