#!/usr/bin/env node
/**
 * CLI entry point for running a DHT node in Docker
 */
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { multiaddr } from '@multiformats/multiaddr';
import { DHTNode, DHTConfigBuilder } from '../index.js';
import { OverlayNetwork } from '../overlay/index.js';

// Configuration from environment
const NODE_ID = process.env.NODE_ID || 'node-0';
const NODE_INDEX = process.env.NODE_INDEX || '1';  // Unique index for public address routing
const LISTEN_PORT = parseInt(process.env.LISTEN_PORT || '4001', 10);
const WS_PORT = parseInt(process.env.WS_PORT || '8080', 10);
const METRICS_PORT = parseInt(process.env.METRICS_PORT || '9090', 10);
const BOOTSTRAP_URL = process.env.BOOTSTRAP_URL || '';  // e.g., ws://bootstrap:8080
const BOOTSTRAP_PEER_ID = process.env.BOOTSTRAP_PEER_ID || '';
const IS_BOOTSTRAP = process.env.IS_BOOTSTRAP === 'true';
const EXTERNAL_HOST = process.env.EXTERNAL_HOST || 'localhost';
const PUBLIC_PATH = process.env.PUBLIC_PATH || `/dht/node-${NODE_INDEX}`;  // Path for nginx routing
const K_BUCKET_SIZE = parseInt(process.env.K_BUCKET_SIZE || '20', 10);
const MAX_CONNECTIONS = parseInt(process.env.MAX_CONNECTIONS || '50', 10);

let node: DHTNode | null = null;
let overlay: OverlayNetwork | null = null;
let startTime = Date.now();

// Helper function to discover peers through DHT lookups and connect to them
async function discoverPeers(): Promise<void> {
  if (!node) return;
  
  try {
    const libp2pNode = node.getLibp2pNode();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dht = (libp2pNode as any).services?.dht;
    
    if (!dht) return;
    
    // Collect discovered peers from DHT queries
    const discoveredPeers = new Map<string, string[]>(); // peerId -> multiaddrs
    const myPeerId = node.peerId.toString();
    
    // Perform self-lookup to find peers close to us
    const selfKey = node.peerId.toMultihash().bytes;
    
    try {
      for await (const event of dht.getClosestPeers(selfKey)) {
        if (event.name === 'PEER_RESPONSE' && event.closer) {
          for (const peer of event.closer) {
            const peerId = peer.id.toString();
            if (peerId !== myPeerId && peer.multiaddrs?.length > 0) {
              discoveredPeers.set(peerId, peer.multiaddrs.map((ma: { toString: () => string }) => ma.toString()));
            }
          }
        }
        if (event.name === 'FINAL_PEER' && event.peer) {
          const peerId = event.peer.id.toString();
          if (peerId !== myPeerId && event.peer.multiaddrs?.length > 0) {
            discoveredPeers.set(peerId, event.peer.multiaddrs.map((ma: { toString: () => string }) => ma.toString()));
          }
        }
      }
    } catch {
      // Ignore lookup errors
    }
    
    // Perform random lookups to discover more peers
    for (let i = 0; i < 3; i++) {
      const randomKey = new Uint8Array(32);
      crypto.getRandomValues(randomKey);
      
      try {
        for await (const event of dht.getClosestPeers(randomKey)) {
          if (event.name === 'PEER_RESPONSE' && event.closer) {
            for (const peer of event.closer) {
              const peerId = peer.id.toString();
              if (peerId !== myPeerId && peer.multiaddrs?.length > 0) {
                discoveredPeers.set(peerId, peer.multiaddrs.map((ma: { toString: () => string }) => ma.toString()));
              }
            }
          }
          if (event.name === 'FINAL_PEER' && event.peer) {
            const peerId = event.peer.id.toString();
            if (peerId !== myPeerId && event.peer.multiaddrs?.length > 0) {
              discoveredPeers.set(peerId, event.peer.multiaddrs.map((ma: { toString: () => string }) => ma.toString()));
            }
          }
        }
      } catch {
        // Ignore lookup errors
      }
    }
    
    // Now connect to discovered peers that we're not already connected to
    const connectedPeers = new Set(node.getConnectionInfo().connectedPeers);
    let connectedCount = 0;
    
    for (const [peerId, multiaddrs] of discoveredPeers) {
      if (connectedPeers.has(peerId)) continue; // Already connected
      
      // Try to connect to this peer
      for (const addr of multiaddrs) {
        try {
          await libp2pNode.dial(multiaddr(addr));
          connectedCount++;
          console.log(`[${NODE_ID}] Connected to discovered peer: ${peerId.slice(0, 20)}...`);
          break; // Successfully connected, no need to try other addresses
        } catch {
          // Try next address
        }
      }
    }
    
    if (discoveredPeers.size > 0 || connectedCount > 0) {
      console.log(`[${NODE_ID}] Peer discovery: found ${discoveredPeers.size} peers, connected to ${connectedCount} new peers`);
    }
  } catch {
    // Ignore discovery errors
  }
}

// Helper to fetch bootstrap peer ID from bootstrap node's /info endpoint
async function fetchBootstrapPeerId(bootstrapHost: string): Promise<string | null> {
  const metricsUrl = `http://${bootstrapHost}:9090/info`;
  console.log(`[${NODE_ID}] Fetching bootstrap peer ID from ${metricsUrl}...`);
  
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(metricsUrl);
      if (response.ok) {
        const info = await response.json() as { peerId?: string };
        if (info.peerId) {
          console.log(`[${NODE_ID}] Got bootstrap peer ID: ${info.peerId}`);
          return info.peerId;
        }
      }
    } catch {
      // Retry
    }
    console.log(`[${NODE_ID}] Waiting for bootstrap node... (attempt ${attempt + 1}/30)`);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return null;
}

async function main() {
  console.log(`[${NODE_ID}] Starting DHT node...`);
  console.log(`[${NODE_ID}] Configuration:`);
  console.log(`  - Node Index: ${NODE_INDEX}`);
  console.log(`  - Listen Port: ${LISTEN_PORT}`);
  console.log(`  - WebSocket Port: ${WS_PORT}`);
  console.log(`  - Metrics Port: ${METRICS_PORT}`);
  console.log(`  - Bootstrap Mode: ${IS_BOOTSTRAP}`);
  console.log(`  - External Host: ${EXTERNAL_HOST}`);
  console.log(`  - Public Path: ${PUBLIC_PATH}`);
  console.log(`  - Bootstrap URL: ${BOOTSTRAP_URL || 'none'}`);

  // Build bootstrap multiaddr if we're not the bootstrap node
  let bootstrapPeers: string[] = [];
  if (!IS_BOOTSTRAP && BOOTSTRAP_URL) {
    // Parse bootstrap URL to get host (e.g., ws://bootstrap:8080 -> bootstrap)
    const url = new URL(BOOTSTRAP_URL);
    const bootstrapHost = url.hostname;
    
    // Get peer ID - either from env or fetch from bootstrap node
    let peerId = BOOTSTRAP_PEER_ID;
    if (!peerId) {
      peerId = await fetchBootstrapPeerId(bootstrapHost) || '';
    }
    
    if (peerId) {
      // Construct multiaddr for internal Docker network
      bootstrapPeers = [`/dns4/${bootstrapHost}/tcp/${url.port || '8080'}/ws/p2p/${peerId}`];
      console.log(`[${NODE_ID}] Bootstrap peer: ${bootstrapPeers[0]}`);
    } else {
      console.error(`[${NODE_ID}] Could not get bootstrap peer ID`);
    }
  }

  // Build configuration
  const configBuilder = DHTConfigBuilder.create()
    .withListenAddresses([
      `/ip4/0.0.0.0/tcp/${LISTEN_PORT}`,
      `/ip4/0.0.0.0/tcp/${WS_PORT}/ws`,
    ])
    .withKBucketSize(K_BUCKET_SIZE)
    .withMaxConnections(MAX_CONNECTIONS)
    .withRefreshInterval(30000)
    .withCircuitRelay(true); // Enable circuit relay for NAT traversal

  // Set announce addresses with ONLY the public WSS address
  // This ensures all nodes advertise their public address for external connectivity
  //
  // We use port-based routing: each node gets a unique port (4001 + NODE_INDEX)
  // This avoids the complexity of path-based multiaddr which libp2p doesn't support natively.
  // nginx will route based on port, or we expose ports directly.
  //
  // For path-based routing through nginx, we need to NOT set announce addresses
  // and let peers discover this node through DHT queries. The internal Docker
  // addresses will be filtered out by libp2p's address filtering.
  //
  // For now, we'll use the internal listen address and rely on DHT discovery.
  // External clients will connect via the bootstrap node which has a public address.
  console.log(`[${NODE_ID}] Public path: ${PUBLIC_PATH} (path-based routing via nginx)`);

  // Add bootstrap peers if not bootstrap node
  if (!IS_BOOTSTRAP && bootstrapPeers.length > 0) {
    configBuilder.withBootstrapPeers(bootstrapPeers);
  }

  const config = configBuilder.build();

  // Create and start node
  node = new DHTNode(config);
  await node.start();

  console.log(`[${NODE_ID}] Node started with PeerId: ${node.peerId.toString()}`);
  console.log(`[${NODE_ID}] Listening on:`);
  for (const addr of node.multiaddrs) {
    console.log(`  - ${addr.toString()}`);
  }

  // Start metrics/health server EARLY so health checks pass during bootstrap
  startMetricsServer();

  // Bootstrap if we have peers (with timeout)
  if (!IS_BOOTSTRAP && bootstrapPeers.length > 0) {
    console.log(`[${NODE_ID}] Bootstrapping...`);
    try {
      // Add timeout to bootstrap to prevent hanging
      const bootstrapTimeout = 30000; // 30 seconds
      await Promise.race([
        node.bootstrap(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Bootstrap timeout')), bootstrapTimeout)
        )
      ]);
      console.log(`[${NODE_ID}] Bootstrap complete`);
      
      // Wait for DHT to stabilize before starting overlay
      console.log(`[${NODE_ID}] Waiting for DHT to stabilize...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Perform additional peer discovery
      console.log(`[${NODE_ID}] Performing peer discovery...`);
      await discoverPeers();
    } catch (err) {
      console.error(`[${NODE_ID}] Bootstrap failed:`, err);
      // Continue anyway - the node can still function and discover peers later
    }
  }

  // Periodic peer discovery to build routing table
  setInterval(async () => {
    if (node) {
      try {
        await discoverPeers();
      } catch {
        // Ignore discovery errors
      }
    }
  }, 60000); // Every 60 seconds

  // Initialize overlay network with shorter key publish interval for faster propagation
  overlay = new OverlayNetwork(node, {
    defaultTTL: 20,
    responseTimeout: 30000,
    defaultRedundancy: 3,
    encryption: {
      enabled: true,
      keyPublishInterval: 30000, // Republish keys every 30 seconds
      keyCacheTTL: 60000, // Cache keys for 1 minute
    },
  });
  
  // Start overlay with retry logic for key publishing
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await overlay.start();
      console.log(`[${NODE_ID}] Overlay network started, public key published`);
      break;
    } catch (err) {
      console.error(`[${NODE_ID}] Overlay start attempt ${attempt + 1} failed:`, err);
      if (attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  // Register echo handler for overlay messages
  overlay.onMessage(async (payload, context) => {
    console.log(`[${NODE_ID}] Received overlay message from ${context.originPeerId}`);
    // Echo back the payload with metadata
    const response = {
      echo: new TextDecoder().decode(payload),
      from: node?.peerId.toString(),
      nodeId: NODE_ID,
      timestamp: Date.now(),
    };
    return new TextEncoder().encode(JSON.stringify(response));
  });

  // Log routing table periodically
  setInterval(() => {
    if (node) {
      const info = node.getRoutingTableInfo();
      console.log(`[${NODE_ID}] Routing table: ${info.totalPeers} peers in ${info.buckets.filter(b => b.peers.length > 0).length} buckets`);
    }
  }, 30000);
}

function startMetricsServer() {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        nodeId: NODE_ID,
        peerId: node?.peerId.toString(),
        uptime: Date.now() - startTime,
      }));
    } else if (req.url === '/metrics') {
      const info = node?.getRoutingTableInfo();
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`# HELP dht_peers_total Total peers in routing table
# TYPE dht_peers_total gauge
dht_peers_total{node="${NODE_ID}"} ${info?.totalPeers || 0}

# HELP dht_buckets_active Active k-buckets
# TYPE dht_buckets_active gauge
dht_buckets_active{node="${NODE_ID}"} ${info?.buckets.filter(b => b.peers.length > 0).length || 0}

# HELP dht_uptime_seconds Node uptime in seconds
# TYPE dht_uptime_seconds gauge
dht_uptime_seconds{node="${NODE_ID}"} ${(Date.now() - startTime) / 1000}
`);
    } else if (req.url === '/info') {
      const info = node?.getRoutingTableInfo();
      // Note: We show the public endpoint URL, not a multiaddr (since libp2p doesn't support path-based multiaddrs)
      const publicEndpoint = `wss://${EXTERNAL_HOST}${PUBLIC_PATH}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        nodeId: NODE_ID,
        nodeIndex: NODE_INDEX,
        peerId: node?.peerId.toString(),
        multiaddrs: node?.multiaddrs.map(a => a.toString()),
        publicEndpoint: publicEndpoint,
        routingTable: info,
        uptime: Date.now() - startTime,
        isBootstrap: IS_BOOTSTRAP,
        overlay: {
          enabled: overlay?.isStarted || false,
          peerId: overlay?.peerId,
        }
      }, null, 2));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(METRICS_PORT, () => {
    console.log(`[${NODE_ID}] Metrics server listening on port ${METRICS_PORT}`);
  });
}

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`[${NODE_ID}] Received ${signal}, shutting down...`);
  if (overlay) {
    await overlay.stop();
  }
  if (node) {
    await node.stop();
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((err) => {
  console.error(`[${NODE_ID}] Fatal error:`, err);
  process.exit(1);
});
