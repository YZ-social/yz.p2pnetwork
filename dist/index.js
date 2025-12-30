/**
 * Kademlia DHT with libp2p
 *
 * Main entry point exporting public types and classes for the DHT implementation.
 *
 * Requirements: 1.1, 8.1
 */
// Main DHT Node class and related types
export { DHTNode, } from './dht/node.js';
// Configuration types and builder
export { DHTConfigBuilder, ConfigValidationError, DEFAULT_CONFIG, validateConfig, serializeConfig, deserializeConfig, } from './dht/config.js';
// Error types
export { DHTError, DHTErrorCode, } from './dht/errors.js';
// Routing table types
export { getRoutingTableInfo, } from './dht/routing.js';
// Distance utilities (useful for advanced use cases)
export { xorDistance, compareDistance, getBucketIndex, } from './dht/distance.js';
// Re-export CID from node.ts for convenience
export { CID } from './dht/node.js';
//# sourceMappingURL=index.js.map