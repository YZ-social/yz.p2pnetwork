/**
 * Factory for creating libp2p nodes with Kademlia DHT support.
 * 
 * Configures transports (TCP, WebSocket, WebRTC), connection encryption (noise),
 * stream muxer (yamux), Kademlia DHT service, and circuit relay for NAT traversal.
 */

import { createLibp2p, type Libp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { webRTC } from '@libp2p/webrtc';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { kadDHT } from '@libp2p/kad-dht';
import { circuitRelayTransport, circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { ping } from '@libp2p/ping';
import { bootstrap } from '@libp2p/bootstrap';
import type { Transport } from '@libp2p/interface';
import type { Multiaddr } from '@multiformats/multiaddr';

import { type DHTNodeConfig, DEFAULT_CONFIG, validateConfig } from './config.js';
import { DHTError, DHTErrorCode } from './errors.js';
import { isInternalAddress } from '../config/address-utils.js';

/**
 * Check if a multiaddr contains WebSocket protocols
 * 
 * This is a more permissive check than the standard multiaddr-matcher
 * that allows http-path and other extensions needed for nginx routing.
 */
function isWebSocketMultiaddr(ma: Multiaddr): boolean {
  const str = ma.toString();
  return str.includes('/ws/') || str.includes('/wss/') || 
         str.endsWith('/ws') || str.endsWith('/wss');
}

/**
 * Create a WebSocket transport with permissive filtering for http-path
 * 
 * The standard @libp2p/websockets transport filters out multiaddrs with
 * http-path because the multiaddr-matcher doesn't recognize it. This custom
 * transport uses a more permissive filter that accepts any multiaddr containing
 * /ws or /wss protocols.
 */
function webSocketsWithHttpPath(): ReturnType<typeof webSockets> {
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

/**
 * Creates a libp2p node configured with Kademlia DHT support.
 * 
 * @param config - DHT node configuration
 * @returns Promise resolving to a configured libp2p node
 * @throws DHTError with INVALID_CONFIG if configuration is invalid
 * @throws DHTError with KEY_GENERATION_FAILED if node creation fails
 */
export async function createLibp2pNode(config: DHTNodeConfig): Promise<Libp2p> {
  // Validate configuration first
  try {
    validateConfig(config);
  } catch (error) {
    throw new DHTError(
      DHTErrorCode.INVALID_CONFIG,
      error instanceof Error ? error.message : 'Invalid configuration',
      { cause: error instanceof Error ? error : undefined, context: { config } }
    );
  }

  try {
    // Build libp2p options based on configuration
    const libp2pOptions = buildLibp2pOptions(config);

    // Create the libp2p node
    const node = await createLibp2p(libp2pOptions);

    return node;
  } catch (error) {
    throw new DHTError(
      DHTErrorCode.KEY_GENERATION_FAILED,
      `Failed to create libp2p node: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error instanceof Error ? error : undefined }
    );
  }
}

/**
 * Builds the complete libp2p options object based on configuration.
 */
function buildLibp2pOptions(config: DHTNodeConfig) {
  // Build transports array
  // Use custom WebSocket transport that supports http-path for nginx routing
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transports: any[] = [
    tcp(),
    webSocketsWithHttpPath(),
  ];

  // Add WebRTC transport if enabled
  if (config.webrtc?.enabled) {
    transports.push(webRTC());
    // WebRTC requires circuit relay transport for signaling
    if (!config.circuitRelay?.enabled) {
      transports.push(circuitRelayTransport());
    }
  }

  // Add circuit relay transport if enabled (for NAT traversal)
  if (config.circuitRelay?.enabled) {
    transports.push(circuitRelayTransport());
  }

  // Build services object
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const services: Record<string, any> = {
    identify: identify(),
    ping: ping(),
    dht: kadDHT({
      protocol: config.protocol ?? DEFAULT_CONFIG.protocol,
      clientMode: config.clientMode ?? false,
      kBucketSize: config.kBucketSize ?? DEFAULT_CONFIG.kBucketSize,
      // Allow queries even with few peers (important for small networks)
      allowQueryWithZeroPeers: true,
      // Refresh routing table more frequently
      querySelfInterval: 30000, // 30 seconds
      initialQuerySelfInterval: 5000, // 5 seconds after start
      // CRITICAL: Filter out internal addresses from peer info
      // The peer store may contain internal Docker addresses from connections,
      // but we only want to advertise public addresses that browsers can dial.
      // This mapper filters addresses to only include public ones.
      peerInfoMapper: (peerInfo) => {
        if (!peerInfo || !peerInfo.multiaddrs) {
          return peerInfo;
        }
        // Filter out internal addresses (Docker IPs, localhost, private ranges)
        const publicAddrs = peerInfo.multiaddrs.filter((ma: { toString: () => string }) => {
          const addrStr = ma.toString();
          return !isInternalAddress(addrStr);
        });
        // If we have public addresses, use only those
        // If no public addresses, keep original (better than nothing for internal network)
        if (publicAddrs.length > 0) {
          return {
            ...peerInfo,
            multiaddrs: publicAddrs,
          };
        }
        return peerInfo;
      },
    }),
  };

  // Add bootstrap service if bootstrap peers are configured
  if (config.bootstrapPeers && config.bootstrapPeers.length > 0) {
    services.bootstrap = bootstrap({
      list: config.bootstrapPeers,
    });
  }

  // Add circuit relay server if circuit relay is enabled
  if (config.circuitRelay?.enabled) {
    services.circuitRelay = circuitRelayServer({
      reservations: {
        maxReservations: 128,
        reservationTtl: config.circuitRelay.reservationTTL ?? 7200000, // 2 hours default
      },
    });
  }

  return {
    addresses: {
      listen: config.listenAddresses,
      announce: config.announceAddresses,
    },
    transports,
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services,
    connectionManager: {
      maxConnections: config.maxConnections ?? DEFAULT_CONFIG.maxConnections,
      minConnections: config.minConnections ?? DEFAULT_CONFIG.minConnections,
    },
  };
}
