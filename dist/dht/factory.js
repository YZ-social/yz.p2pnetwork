/**
 * Factory for creating libp2p nodes with Kademlia DHT support.
 *
 * Configures transports (TCP, WebSocket, WebRTC), connection encryption (noise),
 * stream muxer (yamux), Kademlia DHT service, and circuit relay for NAT traversal.
 */
import { createLibp2p } from 'libp2p';
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
import { DEFAULT_CONFIG, validateConfig } from './config.js';
import { DHTError, DHTErrorCode } from './errors.js';
/**
 * Creates a libp2p node configured with Kademlia DHT support.
 *
 * @param config - DHT node configuration
 * @returns Promise resolving to a configured libp2p node
 * @throws DHTError with INVALID_CONFIG if configuration is invalid
 * @throws DHTError with KEY_GENERATION_FAILED if node creation fails
 */
export async function createLibp2pNode(config) {
    // Validate configuration first
    try {
        validateConfig(config);
    }
    catch (error) {
        throw new DHTError(DHTErrorCode.INVALID_CONFIG, error instanceof Error ? error.message : 'Invalid configuration', { cause: error instanceof Error ? error : undefined, context: { config } });
    }
    try {
        // Build libp2p options based on configuration
        const libp2pOptions = buildLibp2pOptions(config);
        // Create the libp2p node
        const node = await createLibp2p(libp2pOptions);
        return node;
    }
    catch (error) {
        throw new DHTError(DHTErrorCode.KEY_GENERATION_FAILED, `Failed to create libp2p node: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error instanceof Error ? error : undefined });
    }
}
/**
 * Builds the complete libp2p options object based on configuration.
 */
function buildLibp2pOptions(config) {
    // Build transports array
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transports = [
        tcp(),
        webSockets(),
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
    const services = {
        identify: identify(),
        ping: ping(),
        dht: kadDHT({
            protocol: config.protocol ?? DEFAULT_CONFIG.protocol,
            clientMode: config.clientMode ?? false,
            kBucketSize: config.kBucketSize ?? DEFAULT_CONFIG.kBucketSize,
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
//# sourceMappingURL=factory.js.map