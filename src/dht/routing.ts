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
 * Get addresses for a peer from the peer store.
 * The peer store contains listening addresses from the identify protocol,
 * which are the correct addresses for connecting to a peer.
 * 
 * @param node - The libp2p node
 * @param peerId - The peer ID to get addresses for
 * @returns Array of multiaddrs from the peer store, or empty array if not found
 */
async function getPeerStoreAddresses(node: Libp2p, peerId: PeerId): Promise<Multiaddr[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const peerStore = (node as any).peerStore;
    if (!peerStore) return [];
    
    // Try the new API first (libp2p 1.x)
    if (typeof peerStore.get === 'function') {
      try {
        const peerData = await peerStore.get(peerId);
        if (peerData?.addresses && peerData.addresses.length > 0) {
          return peerData.addresses.map((a: { multiaddr: Multiaddr }) => a.multiaddr);
        }
      } catch {
        // Peer not in store
      }
    }
    
    // Try addressBook API (older versions)
    if (peerStore.addressBook) {
      try {
        const addrs = await peerStore.addressBook.get(peerId);
        if (addrs && addrs.length > 0) {
          return addrs.map((a: { multiaddr: Multiaddr }) => a.multiaddr);
        }
      } catch {
        // Not found
      }
    }
  } catch {
    // Ignore errors
  }
  return [];
}

/**
 * Extract routing table information from a libp2p node with DHT service.
 * 
 * This function accesses the internal DHT routing table to provide
 * diagnostic information about the current state of peer organization.
 * 
 * IMPORTANT: This function uses addresses from the peer store (populated by
 * the identify protocol) rather than the addresses stored in the DHT's k-bucket.
 * The k-bucket may store ephemeral connection addresses, while the peer store
 * has the correct listening addresses that other peers can connect to.
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

  // Collect peer IDs from the DHT routing table
  const peerIds: PeerId[] = [];
  
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
        // We need to traverse the tree to find all peer IDs
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const collectPeerIds = (kbNode: any): void => {
          if (!kbNode) return;
          
          // If this node has peers, collect their IDs
          if (kbNode.peers && Array.isArray(kbNode.peers)) {
            for (const contact of kbNode.peers) {
              const peerId = contact.peer ?? contact.id ?? contact.peerId ?? contact;
              if (peerId) {
                peerIds.push(peerId);
              }
            }
          }
          
          // Also check for 'contacts' (older versions)
          if (kbNode.contacts && Array.isArray(kbNode.contacts)) {
            for (const contact of kbNode.contacts) {
              const peerId = contact.peer ?? contact.id ?? contact.peerId ?? contact;
              if (peerId) {
                peerIds.push(peerId);
              }
            }
          }
          
          // Recursively traverse left and right children
          if (kbNode.left) {
            collectPeerIds(kbNode.left);
          }
          if (kbNode.right) {
            collectPeerIds(kbNode.right);
          }
        };
        
        // Start traversal from root
        if (kb.root) {
          collectPeerIds(kb.root);
        }
        
        // Alternative: try toIterable() if available
        if (peerIds.length === 0 && typeof kb.toIterable === 'function') {
          try {
            for (const contact of kb.toIterable()) {
              const peerId = contact.peer ?? contact.id ?? contact.peerId ?? contact;
              if (peerId) {
                peerIds.push(peerId);
              }
            }
          } catch {
            // toIterable failed
          }
        }
        
        // Alternative: try closest() to enumerate peers
        if (peerIds.length === 0 && typeof kb.closest === 'function') {
          try {
            const randomKey = new Uint8Array(32);
            const peers = kb.closest(randomKey, 1000);
            if (peers && Array.isArray(peers)) {
              for (const contact of peers) {
                const peerId = contact.peer ?? contact.id ?? contact.peerId ?? contact;
                if (peerId) {
                  peerIds.push(peerId);
                }
              }
            }
          } catch {
            // closest failed
          }
        }
      }
    }
  } catch {
    // If we can't access the routing table, fall back to connections
  }
  
  // If no peers from routing table, use connections
  if (peerIds.length === 0) {
    const connections = node.getConnections();
    const seenPeers = new Set<string>();
    for (const conn of connections) {
      const peerIdStr = conn.remotePeer.toString();
      if (!seenPeers.has(peerIdStr)) {
        seenPeers.add(peerIdStr);
        peerIds.push(conn.remotePeer);
      }
    }
  }

  // Now build the routing table info using peer store addresses
  // We do this synchronously by using a simpler approach
  const buckets: BucketInfo[] = [];
  const bucket: BucketInfo = {
    index: 0,
    peers: [],
    lastRefresh: new Date(),
  };
  
  // Get connection addresses as fallback
  const connectionAddrs = new Map<string, Multiaddr>();
  for (const conn of node.getConnections()) {
    connectionAddrs.set(conn.remotePeer.toString(), conn.remoteAddr);
  }
  
  // For each peer, try to get addresses from peer store synchronously
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const peerStore = (node as any).peerStore;
  
  for (const peerId of peerIds) {
    let addrs: Multiaddr[] = [];
    
    // Try to get addresses from peer store cache
    if (peerStore) {
      try {
        // The peer store may have a synchronous cache
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cache = (peerStore as any).store?.datastore?.data;
        if (cache) {
          // Try to find cached addresses
          for (const [key, value] of cache.entries?.() ?? []) {
            if (key.includes(peerId.toString()) && key.includes('addrs')) {
              // Found address data
              if (value && Array.isArray(value)) {
                addrs = value;
              }
            }
          }
        }
      } catch {
        // Cache access failed
      }
    }
    
    // Fall back to connection address if no peer store addresses
    if (addrs.length === 0) {
      const connAddr = connectionAddrs.get(peerId.toString());
      if (connAddr) {
        addrs = [connAddr];
      }
    }
    
    bucket.peers.push({
      id: peerId,
      multiaddrs: addrs,
      lastSeen: new Date(),
    });
  }
  
  if (bucket.peers.length > 0) {
    buckets.push(bucket);
  }

  return {
    localPeerId,
    buckets,
    totalPeers: peerIds.length,
  };
}

/**
 * Async version of getRoutingTableInfo that properly fetches addresses from peer store.
 * Use this when you need accurate listening addresses for peers.
 * 
 * @param node - The libp2p node with DHT service
 * @returns Promise resolving to RoutingTableInfo with peer store addresses
 */
export async function getRoutingTableInfoAsync(node: Libp2p): Promise<RoutingTableInfo> {
  // Access the DHT service
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const services = (node as any).services;
  if (!services?.dht) {
    throw new Error('DHT service is not available on this node');
  }

  const dht = services.dht;
  const localPeerId = node.peerId.toString();

  // Collect peer IDs from the DHT routing table
  const peerIds: PeerId[] = [];
  
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const routingTable = (dht as any).routingTable;
    
    if (routingTable?.kb) {
      const kb = routingTable.kb;
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const collectPeerIds = (kbNode: any): void => {
        if (!kbNode) return;
        
        if (kbNode.peers && Array.isArray(kbNode.peers)) {
          for (const contact of kbNode.peers) {
            const peerId = contact.peer ?? contact.id ?? contact.peerId ?? contact;
            if (peerId) peerIds.push(peerId);
          }
        }
        
        if (kbNode.contacts && Array.isArray(kbNode.contacts)) {
          for (const contact of kbNode.contacts) {
            const peerId = contact.peer ?? contact.id ?? contact.peerId ?? contact;
            if (peerId) peerIds.push(peerId);
          }
        }
        
        if (kbNode.left) collectPeerIds(kbNode.left);
        if (kbNode.right) collectPeerIds(kbNode.right);
      };
      
      if (kb.root) collectPeerIds(kb.root);
    }
  } catch {
    // Fall back to connections
  }
  
  // If no peers from routing table, use connections
  if (peerIds.length === 0) {
    const connections = node.getConnections();
    const seenPeers = new Set<string>();
    for (const conn of connections) {
      const peerIdStr = conn.remotePeer.toString();
      if (!seenPeers.has(peerIdStr)) {
        seenPeers.add(peerIdStr);
        peerIds.push(conn.remotePeer);
      }
    }
  }

  // Get connection addresses as fallback
  const connectionAddrs = new Map<string, Multiaddr>();
  for (const conn of node.getConnections()) {
    connectionAddrs.set(conn.remotePeer.toString(), conn.remoteAddr);
  }

  // Build routing table info with peer store addresses
  const bucket: BucketInfo = {
    index: 0,
    peers: [],
    lastRefresh: new Date(),
  };
  
  for (const peerId of peerIds) {
    // Get addresses from peer store (async)
    let addrs = await getPeerStoreAddresses(node, peerId);
    
    // Fall back to connection address if no peer store addresses
    if (addrs.length === 0) {
      const connAddr = connectionAddrs.get(peerId.toString());
      if (connAddr) {
        addrs = [connAddr];
      }
    }
    
    bucket.peers.push({
      id: peerId,
      multiaddrs: addrs,
      lastSeen: new Date(),
    });
  }
  
  const buckets: BucketInfo[] = bucket.peers.length > 0 ? [bucket] : [];

  return {
    localPeerId,
    buckets,
    totalPeers: peerIds.length,
  };
}
