/**
 * Factory for creating libp2p nodes with Kademlia DHT support.
 *
 * Configures transports (TCP, WebSocket, WebRTC), connection encryption (noise),
 * stream muxer (yamux), Kademlia DHT service, and circuit relay for NAT traversal.
 */
import { type Libp2p } from 'libp2p';
import { type DHTNodeConfig } from './config.js';
/**
 * Creates a libp2p node configured with Kademlia DHT support.
 *
 * @param config - DHT node configuration
 * @returns Promise resolving to a configured libp2p node
 * @throws DHTError with INVALID_CONFIG if configuration is invalid
 * @throws DHTError with KEY_GENERATION_FAILED if node creation fails
 */
export declare function createLibp2pNode(config: DHTNodeConfig): Promise<Libp2p>;
//# sourceMappingURL=factory.d.ts.map