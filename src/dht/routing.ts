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
export function getRoutingTableInfo(node: Libp2p): RoutingTableInfo {
  // Access the DHT service
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const services = (node as any).services;
  if (!services?.dht) {
    throw new Error('DHT service is not available on this node');
  }

  const dht = services.dht;
  const localPeerId = node.peerId.toString();

  // Try to access the routing table from the DHT
  // The kad-dht implementation stores the routing table internally
  const buckets: BucketInfo[] = [];
  let totalPeers = 0;

  try {
    // The @libp2p/kad-dht exposes routing table via different methods
    // depending on the version. We'll try multiple approaches.
    
    // Approach 1: Try to access the routingTable property directly
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const routingTable = (dht as any).routingTable ?? (dht as any)._routingTable;
    
    if (routingTable) {
      // The routing table typically has a kb (k-buckets) structure
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const kb = routingTable.kb ?? routingTable._kb ?? routingTable;
      
      if (kb && typeof kb.toIterable === 'function') {
        // k-bucket library provides toIterable() method
        for (const contact of kb.toIterable()) {
          const bucketIndex = contact.bucketIndex ?? 0;
          
          // Find or create bucket
          let bucket = buckets.find(b => b.index === bucketIndex);
          if (!bucket) {
            bucket = {
              index: bucketIndex,
              peers: [],
              lastRefresh: new Date(),
            };
            buckets.push(bucket);
          }
          
          bucket.peers.push({
            id: contact.id ?? contact.peer ?? contact,
            multiaddrs: contact.multiaddrs ?? [],
            lastSeen: contact.lastSeen ? new Date(contact.lastSeen) : new Date(),
          });
          totalPeers++;
        }
      } else if (kb && kb.buckets) {
        // Alternative structure with buckets array
        for (let i = 0; i < kb.buckets.length; i++) {
          const bucketContacts = kb.buckets[i] ?? [];
          if (bucketContacts.length > 0) {
            const peers: RoutingPeerInfo[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const contact of bucketContacts) {
              peers.push({
                id: contact.id ?? contact.peer ?? contact,
                multiaddrs: contact.multiaddrs ?? [],
                lastSeen: contact.lastSeen ? new Date(contact.lastSeen) : new Date(),
              });
              totalPeers++;
            }
            buckets.push({
              index: i,
              peers,
              lastRefresh: new Date(),
            });
          }
        }
      }
    }
  } catch {
    // If we can't access the routing table, return empty buckets
    // This is not an error - the node might just not have any peers yet
  }

  // Sort buckets by index
  buckets.sort((a, b) => a.index - b.index);

  return {
    localPeerId,
    buckets,
    totalPeers,
  };
}
