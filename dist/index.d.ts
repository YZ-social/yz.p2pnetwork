/**
 * Kademlia DHT with libp2p
 *
 * Main entry point exporting public types and classes for the DHT implementation.
 *
 * Requirements: 1.1, 8.1
 */
export { DHTNode, type PeerInfo, type ConnectionInfo, type DHTNodeEventType, type DHTNodeEventHandler, } from './dht/node.js';
export { type DHTNodeConfig, type SerializedConfig, type TurnServer, type WebRTCConfig, type CircuitRelayConfig, DHTConfigBuilder, ConfigValidationError, DEFAULT_CONFIG, validateConfig, serializeConfig, deserializeConfig, } from './dht/config.js';
export { DHTError, DHTErrorCode, } from './dht/errors.js';
export { type RoutingTableInfo, type BucketInfo, type RoutingPeerInfo, getRoutingTableInfo, } from './dht/routing.js';
export { xorDistance, compareDistance, getBucketIndex, } from './dht/distance.js';
export { CID } from './dht/node.js';
//# sourceMappingURL=index.d.ts.map