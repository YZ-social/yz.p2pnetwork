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
    // The @libp2p/kad-dht v16+ uses a different internal structure
    // Try multiple approaches to find the routing table
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let routingTable: any = null;
    
    // Approach 1: Direct property access
    routingTable = (dht as any).routingTable ?? (dht as any)._routingTable;
    
    // Approach 2: Check for lan/wan DHT (dual DHT mode)
    if (!routingTable) {
      const lanDht = (dht as any).lan ?? (dht as any)._lan;
      const wanDht = (dht as any).wan ?? (dht as any)._wan;
      routingTable = lanDht?.routingTable ?? wanDht?.routingTable;
    }
    
    // Approach 3: Check components
    if (!routingTable && (dht as any).components) {
      routingTable = (dht as any).components.routingTable;
    }
    
    if (routingTable) {
      // The routing table typically has a kb (k-buckets) structure
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const kb = routingTable.kb ?? routingTable._kb ?? routingTable.kBucket ?? routingTable;
      
      // Try toIterable() method first (k-bucket library)
      if (kb && typeof kb.toIterable === 'function') {
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
          
          // Extract peer ID - could be in different formats
          const peerId = contact.id ?? contact.peer ?? contact.peerId ?? contact;
          
          bucket.peers.push({
            id: peerId,
            multiaddrs: contact.multiaddrs ?? contact.addresses ?? [],
            lastSeen: contact.lastSeen ? new Date(contact.lastSeen) : new Date(),
          });
          totalPeers++;
        }
      }
      // Try closest() method to get all peers
      else if (kb && typeof kb.closest === 'function') {
        // Get closest peers to a random key to enumerate the table
        const randomKey = new Uint8Array(32);
        try {
          const peers = kb.closest(randomKey, 1000); // Get up to 1000 peers
          for (const contact of peers) {
            const peerId = contact.id ?? contact.peer ?? contact.peerId ?? contact;
            
            // Put all in bucket 0 since we don't have bucket info
            let bucket = buckets.find(b => b.index === 0);
            if (!bucket) {
              bucket = { index: 0, peers: [], lastRefresh: new Date() };
              buckets.push(bucket);
            }
            
            bucket.peers.push({
              id: peerId,
              multiaddrs: contact.multiaddrs ?? contact.addresses ?? [],
              lastSeen: contact.lastSeen ? new Date(contact.lastSeen) : new Date(),
            });
            totalPeers++;
          }
        } catch {
          // closest() failed
        }
      }
      // Try buckets array
      else if (kb && kb.buckets) {
        for (let i = 0; i < kb.buckets.length; i++) {
          const bucketContacts = kb.buckets[i] ?? [];
          if (bucketContacts.length > 0) {
            const peers: RoutingPeerInfo[] = [];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const contact of bucketContacts) {
              peers.push({
                id: contact.id ?? contact.peer ?? contact.peerId ?? contact,
                multiaddrs: contact.multiaddrs ?? contact.addresses ?? [],
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
      // Try size property and iterate
      else if (routingTable.size !== undefined && typeof routingTable.size === 'number') {
        // Some implementations expose size and allow iteration
        if (typeof routingTable[Symbol.iterator] === 'function') {
          for (const contact of routingTable) {
            const peerId = contact.id ?? contact.peer ?? contact.peerId ?? contact;
            let bucket = buckets.find(b => b.index === 0);
            if (!bucket) {
              bucket = { index: 0, peers: [], lastRefresh: new Date() };
              buckets.push(bucket);
            }
            bucket.peers.push({
              id: peerId,
              multiaddrs: contact.multiaddrs ?? contact.addresses ?? [],
              lastSeen: new Date(),
            });
            totalPeers++;
          }
        }
      }
    }
    
    // Fallback: Use libp2p's peer store to get connected peers
    // This isn't the DHT routing table but gives us peer info
    if (totalPeers === 0) {
      const connections = node.getConnections();
      if (connections.length > 0) {
        const bucket: BucketInfo = {
          index: 0,
          peers: [],
          lastRefresh: new Date(),
        };
        
        const seenPeers = new Set<string>();
        for (const conn of connections) {
          const peerIdStr = conn.remotePeer.toString();
          if (!seenPeers.has(peerIdStr)) {
            seenPeers.add(peerIdStr);
            bucket.peers.push({
              id: conn.remotePeer,
              multiaddrs: [conn.remoteAddr],
              lastSeen: new Date(),
            });
            totalPeers++;
          }
        }
        
        if (bucket.peers.length > 0) {
          buckets.push(bucket);
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
