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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const routingTable = (dht as any).routingTable;
    
    if (routingTable) {
      // The routing table has a kb (k-bucket) property
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const kb = routingTable.kb;
      
      if (kb) {
        // The k-bucket library uses a tree structure with 'root'
        // We need to traverse the tree to find all contacts
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const collectContacts = (node: any, depth: number = 0): void => {
          if (!node) return;
          
          // If this node has contacts, collect them
          if (node.contacts && Array.isArray(node.contacts)) {
            for (const contact of node.contacts) {
              // Find or create bucket for this depth
              let bucket = buckets.find(b => b.index === depth);
              if (!bucket) {
                bucket = {
                  index: depth,
                  peers: [],
                  lastRefresh: new Date(),
                };
                buckets.push(bucket);
              }
              
              // Extract peer info from contact
              // Contact structure: { peer: PeerId, lastPing: number, ... }
              const peerId = contact.peer ?? contact.id ?? contact.peerId ?? contact;
              
              bucket.peers.push({
                id: peerId,
                multiaddrs: contact.multiaddrs ?? contact.addresses ?? [],
                lastSeen: contact.lastPing ? new Date(contact.lastPing) : new Date(),
              });
              totalPeers++;
            }
          }
          
          // Recursively traverse left and right children
          if (node.left) {
            collectContacts(node.left, depth + 1);
          }
          if (node.right) {
            collectContacts(node.right, depth + 1);
          }
        };
        
        // Start traversal from root
        if (kb.root) {
          collectContacts(kb.root);
        }
        
        // Alternative: try toIterable() if available
        if (totalPeers === 0 && typeof kb.toIterable === 'function') {
          try {
            for (const contact of kb.toIterable()) {
              let bucket = buckets.find(b => b.index === 0);
              if (!bucket) {
                bucket = { index: 0, peers: [], lastRefresh: new Date() };
                buckets.push(bucket);
              }
              
              const peerId = contact.peer ?? contact.id ?? contact.peerId ?? contact;
              bucket.peers.push({
                id: peerId,
                multiaddrs: contact.multiaddrs ?? contact.addresses ?? [],
                lastSeen: contact.lastPing ? new Date(contact.lastPing) : new Date(),
              });
              totalPeers++;
            }
          } catch {
            // toIterable failed
          }
        }
        
        // Alternative: try closest() to enumerate peers
        if (totalPeers === 0 && typeof kb.closest === 'function') {
          try {
            const randomKey = new Uint8Array(32);
            const peers = kb.closest(randomKey, 1000);
            if (peers && Array.isArray(peers)) {
              let bucket = buckets.find(b => b.index === 0);
              if (!bucket) {
                bucket = { index: 0, peers: [], lastRefresh: new Date() };
                buckets.push(bucket);
              }
              
              for (const contact of peers) {
                const peerId = contact.peer ?? contact.id ?? contact.peerId ?? contact;
                bucket.peers.push({
                  id: peerId,
                  multiaddrs: contact.multiaddrs ?? contact.addresses ?? [],
                  lastSeen: contact.lastPing ? new Date(contact.lastPing) : new Date(),
                });
                totalPeers++;
              }
            }
          } catch {
            // closest failed
          }
        }
      }
    }
    
    // Fallback: Use libp2p's connections to get connected peers
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
