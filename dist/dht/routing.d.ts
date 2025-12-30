/**
 * Routing table diagnostics for Kademlia DHT.
 *
 * Provides interfaces and functions to extract routing table state
 * from the DHT internals for diagnostics and testing purposes.
 *
 * Requirements: 3.4
 */
import { type Libp2p } from 'libp2p';
import { type PeerId } from '@libp2p/interface';
import { type Multiaddr } from '@multiformats/multiaddr';
/**
 * Information about a peer in the routing table.
 */
export interface RoutingPeerInfo {
    id: PeerId;
    multiaddrs: Multiaddr[];
    latency?: number;
    lastSeen?: Date;
}
/**
 * Information about a single k-bucket in the routing table.
 */
export interface BucketInfo {
    /** Bucket index (0-255 for 256-bit key space) */
    index: number;
    /** Peers currently in this bucket */
    peers: RoutingPeerInfo[];
    /** Last time this bucket was refreshed */
    lastRefresh: Date;
}
/**
 * Complete routing table state information.
 */
export interface RoutingTableInfo {
    /** Local peer ID as string */
    localPeerId: string;
    /** Array of bucket information */
    buckets: BucketInfo[];
    /** Total number of peers across all buckets */
    totalPeers: number;
}
/**
 * Extract routing table information from a libp2p node with DHT service.
 *
 * This function accesses the internal DHT routing table to provide
 * diagnostic information about the current state of peer organization.
 *
 * @param node - The libp2p node with DHT service
 * @returns RoutingTableInfo containing bucket and peer information
 * @throws Error if DHT service is not available
 */
export declare function getRoutingTableInfo(node: Libp2p): RoutingTableInfo;
//# sourceMappingURL=routing.d.ts.map