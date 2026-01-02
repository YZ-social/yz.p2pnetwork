#!/usr/bin/env node
/**
 * WebSocket Bridge Server for Browser Clients
 * 
 * This server provides a simple WebSocket API for browser clients
 * to interact with the DHT network and overlay messaging system.
 * It connects to the libp2p DHT and exposes:
 * - put/get operations for DHT storage
 * - overlay echo for encrypted messaging tests
 * - closest peers lookup
 */
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { DHTNode, DHTConfigBuilder } from '../index.js';
import { OverlayNetwork } from '../overlay/index.js';

const NODE_ID = process.env.NODE_ID || 'bridge';
const WS_PORT = parseInt(process.env.WS_PORT || '8080', 10);
const METRICS_PORT = parseInt(process.env.METRICS_PORT || '9090', 10);
const BOOTSTRAP_URL = process.env.BOOTSTRAP_URL || '';
const EXTERNAL_HOST = process.env.EXTERNAL_HOST || 'localhost';
const IS_BOOTSTRAP = process.env.IS_BOOTSTRAP === 'true';
const PUBLIC_PATH = process.env.PUBLIC_PATH || '/ws';  // Path for nginx routing (bootstrap uses /ws)

let node: DHTNode | null = null;
let overlay: OverlayNetwork | null = null;
let startTime = Date.now();
const clients = new Map<WebSocket, { id: string; connectedAt: number }>();

// In-memory key-value store for browser clients
const kvStore = new Map<string, string>();

async function fetchBootstrapPeerId(bootstrapHost: string): Promise<string | null> {
  const metricsUrl = `http://${bootstrapHost}:9090/info`;
  console.log(`[${NODE_ID}] Fetching bootstrap peer ID from ${metricsUrl}...`);
  
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(metricsUrl);
      if (response.ok) {
        const info = await response.json() as { peerId?: string };
        if (info.peerId) {
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
  console.log(`[${NODE_ID}] Starting WebSocket Bridge...`);
  console.log(`[${NODE_ID}] Configuration:`);
  console.log(`  - WebSocket Port: ${WS_PORT}`);
  console.log(`  - Metrics Port: ${METRICS_PORT}`);
  console.log(`  - Bootstrap Mode: ${IS_BOOTSTRAP}`);
  console.log(`  - External Host: ${EXTERNAL_HOST}`);
  console.log(`  - Public Path: ${PUBLIC_PATH}`);
  console.log(`  - Bootstrap URL: ${BOOTSTRAP_URL || 'none'}`);
  
  // Build bootstrap multiaddr if we're not the bootstrap node
  let bootstrapPeers: string[] = [];
  if (!IS_BOOTSTRAP && BOOTSTRAP_URL) {
    const url = new URL(BOOTSTRAP_URL);
    const bootstrapHost = url.hostname;
    const peerId = await fetchBootstrapPeerId(bootstrapHost);
    
    if (peerId) {
      bootstrapPeers = [`/dns4/${bootstrapHost}/tcp/${url.port || '8080'}/ws/p2p/${peerId}`];
    }
  }

  // Build configuration
  const configBuilder = DHTConfigBuilder.create()
    .withListenAddresses([
      `/ip4/0.0.0.0/tcp/4001`,
      `/ip4/0.0.0.0/tcp/4002/ws`,
    ])
    .withKBucketSize(20)
    .withMaxConnections(100)
    .withRefreshInterval(30000)
    .withCircuitRelay(true); // Enable circuit relay for NAT traversal

  // Set announce addresses with ONLY the public WSS address
  // This ensures the bootstrap node advertises its public address for external connectivity
  // Format: /dns4/{host}/tcp/443/wss{path} where path is /ws for bootstrap
  if (EXTERNAL_HOST && EXTERNAL_HOST !== 'localhost') {
    const publicAnnounceAddress = `/dns4/${EXTERNAL_HOST}/tcp/443/wss${PUBLIC_PATH}`;
    configBuilder.withAnnounceAddresses([publicAnnounceAddress]);
    console.log(`[${NODE_ID}] Public announce address: ${publicAnnounceAddress}`);
  }

  if (!IS_BOOTSTRAP && bootstrapPeers.length > 0) {
    configBuilder.withBootstrapPeers(bootstrapPeers);
  }

  const config = configBuilder.build();

  // Create and start DHT node
  node = new DHTNode(config);
  await node.start();
  console.log(`[${NODE_ID}] DHT Node started: ${node.peerId.toString()}`);

  // Bootstrap if needed
  if (!IS_BOOTSTRAP && bootstrapPeers.length > 0) {
    try {
      await node.bootstrap();
      console.log(`[${NODE_ID}] Bootstrap complete`);
    } catch (err) {
      console.error(`[${NODE_ID}] Bootstrap failed:`, err);
    }
  }

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
  await overlay.start();
  console.log(`[${NODE_ID}] Overlay network started`);

  // Register echo handler for overlay messages
  overlay.onMessage(async (payload, context) => {
    console.log(`[${NODE_ID}] Received overlay message from ${context.originPeerId}`);
    // Echo back the payload with metadata
    const response = {
      echo: new TextDecoder().decode(payload),
      from: node?.peerId.toString(),
      timestamp: Date.now(),
    };
    return new TextEncoder().encode(JSON.stringify(response));
  });

  // Start WebSocket server for browser clients
  startWebSocketServer();
  
  // Start metrics server
  startMetricsServer();

  // Periodic status log
  setInterval(() => {
    const info = node?.getRoutingTableInfo();
    console.log(`[${NODE_ID}] Peers: ${info?.totalPeers || 0}, Browser clients: ${clients.size}, KV entries: ${kvStore.size}`);
  }, 30000);
}

function startWebSocketServer() {
  const wss = new WebSocketServer({ port: WS_PORT });
  
  wss.on('connection', (ws: WebSocket) => {
    const clientId = `client-${Math.random().toString(36).substring(2, 10)}`;
    clients.set(ws, { id: clientId, connectedAt: Date.now() });
    console.log(`[${NODE_ID}] Browser client connected: ${clientId}`);

    // Send welcome message with full peer ID
    const info = node?.getRoutingTableInfo();
    ws.send(JSON.stringify({
      type: 'welcome',
      nodeId: NODE_ID,
      peerId: node?.peerId.toString(),
      peerCount: info?.totalPeers || 0,
      overlayEnabled: overlay?.isStarted || false,
      timestamp: Date.now()
    }));

    ws.on('message', async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        await handleClientMessage(ws, msg);
      } catch (err) {
        console.error(`[${NODE_ID}] Error handling message:`, err);
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      const client = clients.get(ws);
      console.log(`[${NODE_ID}] Browser client disconnected: ${client?.id}`);
      clients.delete(ws);
    });

    ws.on('error', (err: Error) => {
      console.error(`[${NODE_ID}] WebSocket error:`, err);
    });
  });

  console.log(`[${NODE_ID}] WebSocket server listening on port ${WS_PORT}`);
}

interface ClientMessage {
  type: string;
  key?: string;
  value?: string;
  peerId?: string;
  targetPeerId?: string;
  message?: string;
  count?: number;
}

async function handleClientMessage(ws: WebSocket, msg: ClientMessage) {
  switch (msg.type) {
    case 'hello':
      console.log(`[${NODE_ID}] Client hello: ${msg.peerId}`);
      break;

    case 'put':
      if (msg.key && msg.value) {
        try {
          // Store in local KV store
          kvStore.set(msg.key, msg.value);
          
          // Also try to store in DHT
          if (node) {
            const keyBytes = new TextEncoder().encode(msg.key);
            const valueBytes = new TextEncoder().encode(msg.value);
            await node.put(keyBytes, valueBytes);
          }
          
          ws.send(JSON.stringify({ type: 'put_ack', key: msg.key, success: true }));
          
          // Broadcast to other clients
          broadcastToClients({ type: 'value_stored', key: msg.key }, ws);
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: `Put failed: ${err}` }));
        }
      }
      break;

    case 'get':
      if (msg.key) {
        try {
          // First check local store
          let value = kvStore.get(msg.key);
          
          // If not found locally, try DHT
          if (!value && node) {
            try {
              const keyBytes = new TextEncoder().encode(msg.key);
              const valueBytes = await node.get(keyBytes);
              value = new TextDecoder().decode(valueBytes);
              // Cache locally
              kvStore.set(msg.key, value);
            } catch {
              // Not found in DHT
            }
          }
          
          ws.send(JSON.stringify({ type: 'get_response', key: msg.key, value: value || null }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: `Get failed: ${err}` }));
        }
      }
      break;

    case 'peers':
      {
        const info = node?.getRoutingTableInfo();
        ws.send(JSON.stringify({
          type: 'peers',
          peers: info?.buckets.flatMap(b => b.peers.map(p => p.id.toString())) || [],
          count: info?.totalPeers || 0
        }));
      }
      break;

    case 'closest_peers':
      // Get N closest peers to a key
      if (msg.key) {
        try {
          const count = msg.count || 10;
          const keyBytes = new TextEncoder().encode(msg.key);
          const peerIds: string[] = [];
          
          if (node) {
            // Try DHT lookup first
            try {
              for await (const peer of node.getClosestPeers(keyBytes)) {
                peerIds.push(peer.id.toString());
                if (peerIds.length >= count) break;
              }
            } catch {
              // Fall back to routing table
            }
            
            // If not enough from DHT, add from routing table
            if (peerIds.length < count) {
              const info = node.getRoutingTableInfo();
              for (const bucket of info.buckets) {
                for (const peer of bucket.peers) {
                  const peerId = peer.id.toString();
                  if (!peerIds.includes(peerId)) {
                    peerIds.push(peerId);
                    if (peerIds.length >= count) break;
                  }
                }
                if (peerIds.length >= count) break;
              }
            }
          }
          
          ws.send(JSON.stringify({
            type: 'closest_peers_response',
            key: msg.key,
            peers: peerIds,
            count: peerIds.length
          }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: `Closest peers failed: ${err}` }));
        }
      }
      break;

    case 'overlay_echo':
      // Send encrypted message via overlay and measure latency
      if (msg.targetPeerId && msg.message) {
        const startTime = Date.now();
        try {
          if (!overlay || !overlay.isStarted) {
            ws.send(JSON.stringify({ type: 'error', message: 'Overlay network not available' }));
            return;
          }
          
          const payload = new TextEncoder().encode(msg.message);
          const response = await overlay.sendMessage(msg.targetPeerId, payload, {
            timeout: 30000,
          });
          
          const latency = Date.now() - startTime;
          const responseData = JSON.parse(new TextDecoder().decode(response));
          
          ws.send(JSON.stringify({
            type: 'overlay_echo_response',
            targetPeerId: msg.targetPeerId,
            originalMessage: msg.message,
            echoResponse: responseData,
            latencyMs: latency,
            encrypted: true,
            success: true
          }));
        } catch (err) {
          const latency = Date.now() - startTime;
          ws.send(JSON.stringify({
            type: 'overlay_echo_response',
            targetPeerId: msg.targetPeerId,
            originalMessage: msg.message,
            error: err instanceof Error ? err.message : 'Unknown error',
            latencyMs: latency,
            success: false
          }));
        }
      } else {
        ws.send(JSON.stringify({ type: 'error', message: 'Missing targetPeerId or message' }));
      }
      break;

    case 'overlay_info':
      // Get overlay network info
      if (overlay) {
        const config = overlay.getConfig();
        ws.send(JSON.stringify({
          type: 'overlay_info_response',
          peerId: overlay.peerId,
          isStarted: overlay.isStarted,
          config: {
            maxMessageSize: config.maxMessageSize,
            defaultTTL: config.defaultTTL,
            dedupeWindowMs: config.dedupeWindowMs,
            defaultRedundancy: config.defaultRedundancy,
            responseTimeout: config.responseTimeout,
            encryptionEnabled: config.encryption.enabled,
          }
        }));
      } else {
        ws.send(JSON.stringify({ type: 'error', message: 'Overlay network not initialized' }));
      }
      break;

    default:
      ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
  }
}

function broadcastToClients(msg: object, exclude?: WebSocket) {
  const data = JSON.stringify(msg);
  for (const [ws] of clients) {
    if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

function startMetricsServer() {
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy', nodeId: NODE_ID }));
    } else if (req.url === '/metrics') {
      const info = node?.getRoutingTableInfo();
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`# HELP dht_peers_total Total peers in routing table
# TYPE dht_peers_total gauge
dht_peers_total{node="${NODE_ID}"} ${info?.totalPeers || 0}

# HELP browser_clients_total Connected browser clients
# TYPE browser_clients_total gauge
browser_clients_total{node="${NODE_ID}"} ${clients.size}

# HELP kv_entries_total Key-value entries stored
# TYPE kv_entries_total gauge
kv_entries_total{node="${NODE_ID}"} ${kvStore.size}

# HELP overlay_enabled Overlay network enabled
# TYPE overlay_enabled gauge
overlay_enabled{node="${NODE_ID}"} ${overlay?.isStarted ? 1 : 0}
`);
    } else if (req.url === '/info') {
      const info = node?.getRoutingTableInfo();
      const connectionInfo = node?.getConnectionInfo();
      const publicAnnounceAddress = (EXTERNAL_HOST && EXTERNAL_HOST !== 'localhost') 
        ? `/dns4/${EXTERNAL_HOST}/tcp/443/wss${PUBLIC_PATH}` 
        : null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        nodeId: NODE_ID,
        peerId: node?.peerId.toString(),
        multiaddrs: node?.multiaddrs.map(a => a.toString()),
        announceAddresses: publicAnnounceAddress ? [publicAnnounceAddress] : [],
        routingTable: info,
        connections: connectionInfo,
        browserClients: clients.size,
        kvEntries: kvStore.size,
        uptime: Date.now() - startTime,
        isBootstrap: IS_BOOTSTRAP,
        overlay: {
          enabled: overlay?.isStarted || false,
          peerId: overlay?.peerId,
        }
      }, null, 2));
    } else if (req.url === '/debug/dht') {
      // Debug endpoint to inspect DHT internal structure
      res.writeHead(200, { 'Content-Type': 'application/json' });
      try {
        const libp2pNode = node?.getLibp2pNode();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const services = (libp2pNode as any)?.services;
        const dht = services?.dht;
        
        // Enumerate all properties on the DHT object
        const dhtProps: string[] = [];
        if (dht) {
          for (const key in dht) {
            dhtProps.push(key);
          }
          // Also get own property names
          const ownProps = Object.getOwnPropertyNames(dht);
          for (const prop of ownProps) {
            if (!dhtProps.includes(prop)) {
              dhtProps.push(prop);
            }
          }
        }
        
        // Check for routing table
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const routingTable = (dht as any)?.routingTable ?? (dht as any)?._routingTable;
        const rtProps: string[] = [];
        if (routingTable) {
          for (const key in routingTable) {
            rtProps.push(key);
          }
          const ownProps = Object.getOwnPropertyNames(routingTable);
          for (const prop of ownProps) {
            if (!rtProps.includes(prop)) {
              rtProps.push(prop);
            }
          }
        }
        
        // Check for kb (k-bucket)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const kb = routingTable?.kb ?? routingTable?._kb ?? routingTable?.kBucket;
        const kbProps: string[] = [];
        if (kb) {
          for (const key in kb) {
            kbProps.push(key);
          }
          const ownProps = Object.getOwnPropertyNames(kb);
          for (const prop of ownProps) {
            if (!kbProps.includes(prop)) {
              kbProps.push(prop);
            }
          }
        }
        
        // Check kb.root structure
        const rootProps: string[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let rootPeers: any[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let rootPeerSample: any = null;
        if (kb?.root) {
          for (const key in kb.root) {
            rootProps.push(key);
          }
          const ownProps = Object.getOwnPropertyNames(kb.root);
          for (const prop of ownProps) {
            if (!rootProps.includes(prop)) {
              rootProps.push(prop);
            }
          }
          // Get peers if available (k-bucket uses 'peers' not 'contacts')
          if (kb.root.peers && Array.isArray(kb.root.peers)) {
            rootPeers = kb.root.peers.map((c: { peer?: { toString?: () => string } }) => 
              c.peer?.toString?.() ?? String(c)
            );
            if (kb.root.peers.length > 0) {
              const sample = kb.root.peers[0];
              rootPeerSample = {
                keys: Object.keys(sample || {}),
                peerType: typeof sample?.peer,
                hasPeerToString: typeof sample?.peer?.toString === 'function',
              };
            }
          }
          // Also check for contacts (older versions)
          if (kb.root.contacts && Array.isArray(kb.root.contacts)) {
            rootPeers = kb.root.contacts.map((c: { peer?: { toString?: () => string } }) => 
              c.peer?.toString?.() ?? String(c)
            );
            if (kb.root.contacts.length > 0) {
              const sample = kb.root.contacts[0];
              rootPeerSample = {
                keys: Object.keys(sample || {}),
                peerType: typeof sample?.peer,
                hasPeerToString: typeof sample?.peer?.toString === 'function',
              };
            }
          }
        }
        
        // Check for lan/wan DHT
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lanDht = (dht as any)?.lan ?? (dht as any)?._lan;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wanDht = (dht as any)?.wan ?? (dht as any)?._wan;
        
        const lanProps: string[] = [];
        if (lanDht) {
          for (const key in lanDht) {
            lanProps.push(key);
          }
        }
        
        const wanProps: string[] = [];
        if (wanDht) {
          for (const key in wanDht) {
            wanProps.push(key);
          }
        }
        
        res.end(JSON.stringify({
          dhtExists: !!dht,
          dhtProperties: dhtProps,
          routingTableExists: !!routingTable,
          routingTableProperties: rtProps,
          routingTableSize: routingTable?.size,
          kbExists: !!kb,
          kbProperties: kbProps,
          kbRootExists: !!kb?.root,
          kbRootProperties: rootProps,
          kbRootPeers: rootPeers,
          kbRootPeerSample: rootPeerSample,
          kbRootHasLeft: !!kb?.root?.left,
          kbRootHasRight: !!kb?.root?.right,
          lanDhtExists: !!lanDht,
          lanDhtProperties: lanProps,
          wanDhtExists: !!wanDht,
          wanDhtProperties: wanProps,
          connections: node?.getConnectionInfo(),
        }, null, 2));
      } catch (err) {
        res.end(JSON.stringify({ error: String(err) }));
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(METRICS_PORT, () => {
    console.log(`[${NODE_ID}] Metrics server listening on port ${METRICS_PORT}`);
  });
}

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
