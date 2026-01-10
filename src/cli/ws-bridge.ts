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
import { buildAnnounceAddress, validateNodeAddresses, NodeAddressConfig } from '../config/address-utils.js';

const NODE_ID = process.env.NODE_ID || 'bridge';
const WS_PORT = parseInt(process.env.WS_PORT || '8080', 10);
const METRICS_PORT = parseInt(process.env.METRICS_PORT || '9090', 10);
const BOOTSTRAP_URL = process.env.BOOTSTRAP_URL || '';
const EXTERNAL_HOST = process.env.EXTERNAL_HOST || 'localhost';
const IS_BOOTSTRAP = process.env.IS_BOOTSTRAP === 'true';
const PUBLIC_PATH = process.env.PUBLIC_PATH || '/ws';  // Path for nginx routing (bootstrap uses /ws)

// Browser node configuration
const BROWSER_PEER_ID_MODE = (process.env.BROWSER_PEER_ID_MODE || 'persistent') as 'persistent' | 'ephemeral';
const BROWSER_MAX_CONNECTIONS = parseInt(process.env.BROWSER_MAX_CONNECTIONS || '50', 10);
const BROWSER_DHT_ENABLED = process.env.BROWSER_DHT_ENABLED !== 'false';
const BROWSER_OVERLAY_ENABLED = process.env.BROWSER_OVERLAY_ENABLED !== 'false';

// Relay configuration
const RELAY_MAX_RESERVATIONS = parseInt(process.env.RELAY_MAX_RESERVATIONS || '128', 10);
const RELAY_MAX_CIRCUITS = parseInt(process.env.RELAY_MAX_CIRCUITS || '16', 10);

// Multi-server configuration
const SERVER_INDEX = parseInt(process.env.SERVER_INDEX || '1', 10);
// Cross-server bootstrap URLs (comma-separated), e.g., "wss://imeyouwe.com/ws,wss://node2.imeyouwe.com/ws"
const CROSS_SERVER_BOOTSTRAPS = process.env.CROSS_SERVER_BOOTSTRAPS || '';

let node: DHTNode | null = null;
let overlay: OverlayNetwork | null = null;
let startTime = Date.now();
let announceAddresses: string[] = [];
const clients = new Map<WebSocket, { id: string; connectedAt: number }>();

// In-memory key-value store for browser clients
const kvStore = new Map<string, string>();

// Relay metrics tracking
// Note: libp2p circuit-relay-v2 doesn't expose reservation counts directly,
// so we track them via events when available, or estimate from connections
let relayReservationsActive = 0;
let relayCircuitsActive = 0;
let relayReservationsRejected = 0;
let relayBytesIn = 0;
let relayBytesOut = 0;

/**
 * Parse cross-server bootstrap URLs and filter out self-server.
 * 
 * @param bootstrapUrls - Comma-separated list of bootstrap URLs
 * @param selfHost - External host of this server (to filter out)
 * @returns Array of bootstrap URLs excluding self-server
 */
function parseCrossServerBootstraps(bootstrapUrls: string, selfHost: string): string[] {
  if (!bootstrapUrls) return [];
  
  return bootstrapUrls
    .split(',')
    .map(url => url.trim())
    .filter(url => {
      if (!url) return false;
      try {
        const parsed = new URL(url);
        // Filter out self-server by comparing hostnames
        return parsed.hostname !== selfHost;
      } catch {
        console.warn(`[${NODE_ID}] Invalid cross-server bootstrap URL: ${url}`);
        return false;
      }
    });
}

/**
 * Fetch peer ID from a cross-server bootstrap node via HTTPS.
 * 
 * @param bootstrapUrl - Full WSS URL of the bootstrap (e.g., wss://node2.imeyouwe.com/ws)
 * @returns Peer ID string or null if not available
 */
async function fetchCrossServerPeerId(bootstrapUrl: string): Promise<string | null> {
  try {
    const url = new URL(bootstrapUrl);
    // Convert wss:// to https:// and use /bootstrap/info endpoint
    const infoUrl = `https://${url.hostname}/bootstrap/info`;
    console.log(`[${NODE_ID}] Fetching cross-server peer ID from ${infoUrl}...`);
    
    const response = await fetch(infoUrl, { 
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });
    
    if (response.ok) {
      const info = await response.json() as { peerId?: string };
      if (info.peerId) {
        console.log(`[${NODE_ID}] Got cross-server peer ID: ${info.peerId.slice(0, 16)}...`);
        return info.peerId;
      }
    }
  } catch (err) {
    console.log(`[${NODE_ID}] Failed to fetch cross-server peer ID from ${bootstrapUrl}: ${err}`);
  }
  return null;
}

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
  console.log(`  - Server Index: ${SERVER_INDEX}`);
  console.log(`  - Bootstrap Mode: ${IS_BOOTSTRAP}`);
  console.log(`  - External Host: ${EXTERNAL_HOST}`);
  console.log(`  - Public Path: ${PUBLIC_PATH}`);
  console.log(`  - Bootstrap URL: ${BOOTSTRAP_URL || 'none'}`);
  console.log(`  - Cross-Server Bootstraps: ${CROSS_SERVER_BOOTSTRAPS || 'none'}`);
  
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

  // Add cross-server bootstrap peers (for multi-server deployment)
  // Bootstrap nodes connect to other servers' bootstrap nodes
  if (IS_BOOTSTRAP && CROSS_SERVER_BOOTSTRAPS) {
    const crossServerUrls = parseCrossServerBootstraps(CROSS_SERVER_BOOTSTRAPS, EXTERNAL_HOST);
    console.log(`[${NODE_ID}] Cross-server bootstrap URLs (excluding self): ${crossServerUrls.length}`);
    
    for (const bootstrapUrl of crossServerUrls) {
      const peerId = await fetchCrossServerPeerId(bootstrapUrl);
      if (peerId) {
        try {
          const url = new URL(bootstrapUrl);
          // Construct multiaddr for external WSS connection
          // Format: /dns4/<hostname>/tcp/443/wss/p2p/<peerId>
          const multiaddr = `/dns4/${url.hostname}/tcp/443/wss/p2p/${peerId}`;
          bootstrapPeers.push(multiaddr);
          console.log(`[${NODE_ID}] Added cross-server bootstrap: ${multiaddr.slice(0, 60)}...`);
        } catch (err) {
          console.warn(`[${NODE_ID}] Failed to parse cross-server URL ${bootstrapUrl}: ${err}`);
        }
      }
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

  // Set announce addresses to the public WSS address via nginx
  // Bootstrap node uses /libp2p path for native libp2p protocol connections
  // CRITICAL: Must use withAnnounceAddresses() at config time, NOT addObservedAddr() after start
  if (EXTERNAL_HOST && EXTERNAL_HOST !== 'localhost') {
    // Bootstrap node uses 'libp2p' path for native libp2p connections
    const announceAddr = buildAnnounceAddress(EXTERNAL_HOST, 'libp2p');
    announceAddresses = [announceAddr];
    configBuilder.withAnnounceAddresses(announceAddresses);
    console.log(`[${NODE_ID}] Configured announce address: ${announceAddr}`);
    
    // Validate address configuration
    const addressConfig: NodeAddressConfig = {
      listenAddresses: ['/ip4/0.0.0.0/tcp/4001', '/ip4/0.0.0.0/tcp/4002/ws'],
      announceAddresses,
      externalHost: EXTERNAL_HOST,
      publicPath: '/libp2p',
    };
    const validation = validateNodeAddresses(addressConfig);
    if (!validation.isValid) {
      console.warn(`[${NODE_ID}] Address validation warnings:`);
      for (const warning of validation.warnings) {
        console.warn(`  - ${warning}`);
      }
    }
  } else {
    console.warn(`[${NODE_ID}] No public announce address configured (EXTERNAL_HOST=${EXTERNAL_HOST})`);
  }
  console.log(`[${NODE_ID}] Public endpoint: wss://${EXTERNAL_HOST}${PUBLIC_PATH}`);

  if (!IS_BOOTSTRAP && bootstrapPeers.length > 0) {
    configBuilder.withBootstrapPeers(bootstrapPeers);
  }
  
  // For bootstrap nodes with cross-server peers, add them as bootstrap peers
  if (IS_BOOTSTRAP && bootstrapPeers.length > 0) {
    configBuilder.withBootstrapPeers(bootstrapPeers);
  }

  const config = configBuilder.build();

  // Create and start DHT node
  node = new DHTNode(config);
  await node.start();
  console.log(`[${NODE_ID}] DHT Node started: ${node.peerId.toString()}`);

  // Bootstrap if needed (either non-bootstrap node or bootstrap with cross-server peers)
  if (bootstrapPeers.length > 0) {
    try {
      await node.bootstrap();
      console.log(`[${NODE_ID}] Bootstrap complete (${bootstrapPeers.length} peers)`);
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
          const peers: Array<{ id: string; multiaddrs: string[]; connected: boolean }> = [];
          
          // Get list of connected peers
          const connectedPeers = new Set(node?.getConnectionInfo().connectedPeers || []);
          
          if (node) {
            // Try DHT lookup first
            try {
              for await (const peer of node.getClosestPeers(keyBytes)) {
                const multiaddrs = peer.multiaddrs?.map(ma => ma.toString()) || [];
                const peerId = peer.id.toString();
                peers.push({
                  id: peerId,
                  multiaddrs: multiaddrs,
                  connected: connectedPeers.has(peerId)
                });
                if (peers.length >= count) break;
              }
            } catch {
              // Fall back to routing table
            }
            
            // If not enough from DHT, add from routing table
            if (peers.length < count) {
              const info = node.getRoutingTableInfo();
              const existingIds = new Set(peers.map(p => p.id));
              for (const bucket of info.buckets) {
                for (const peer of bucket.peers) {
                  const peerId = peer.id.toString();
                  if (!existingIds.has(peerId)) {
                    peers.push({
                      id: peerId,
                      multiaddrs: peer.multiaddrs?.map(ma => ma.toString()) || [],
                      connected: connectedPeers.has(peerId)
                    });
                    existingIds.add(peerId);
                    if (peers.length >= count) break;
                  }
                }
                if (peers.length >= count) break;
              }
            }
          }
          
          // Sort to put connected peers first
          peers.sort((a, b) => (b.connected ? 1 : 0) - (a.connected ? 1 : 0));
          
          ws.send(JSON.stringify({
            type: 'closest_peers_response',
            key: msg.key,
            peers: peers.map(p => p.id),
            peerDetails: peers,
            count: peers.length,
            connectedCount: peers.filter(p => p.connected).length
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
          
          console.log(`[${NODE_ID}] Overlay echo request to ${msg.targetPeerId}`);
          
          // Check if target is connected
          const connectionInfo = node?.getConnectionInfo();
          const isConnected = connectionInfo?.connectedPeers.includes(msg.targetPeerId);
          console.log(`[${NODE_ID}] Target ${msg.targetPeerId.slice(0, 16)}... connected: ${isConnected}`);
          
          // Log routing table info
          const routingInfo = node?.getRoutingTableInfo();
          console.log(`[${NODE_ID}] Routing table has ${routingInfo?.totalPeers || 0} peers`);
          
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
          console.error(`[${NODE_ID}] Overlay echo failed:`, err);
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

# HELP relay_reservations_active Current active relay reservations
# TYPE relay_reservations_active gauge
relay_reservations_active{node="${NODE_ID}"} ${relayReservationsActive}

# HELP relay_reservations_max Maximum relay reservations
# TYPE relay_reservations_max gauge
relay_reservations_max{node="${NODE_ID}"} ${RELAY_MAX_RESERVATIONS}

# HELP relay_circuits_active Current active relay circuits
# TYPE relay_circuits_active gauge
relay_circuits_active{node="${NODE_ID}"} ${relayCircuitsActive}

# HELP relay_circuits_max Maximum relay circuits per peer
# TYPE relay_circuits_max gauge
relay_circuits_max{node="${NODE_ID}"} ${RELAY_MAX_CIRCUITS}

# HELP relay_reservations_rejected_total Total rejected reservations
# TYPE relay_reservations_rejected_total counter
relay_reservations_rejected_total{node="${NODE_ID}"} ${relayReservationsRejected}

# HELP relay_bytes_total Total bytes relayed
# TYPE relay_bytes_total counter
relay_bytes_total{node="${NODE_ID}",direction="in"} ${relayBytesIn}
relay_bytes_total{node="${NODE_ID}",direction="out"} ${relayBytesOut}
`);
    } else if (req.url === '/info') {
      const info = node?.getRoutingTableInfo();
      const connectionInfo = node?.getConnectionInfo();
      // Note: We show the public endpoint URL, not a multiaddr (since libp2p doesn't support path-based multiaddrs)
      const publicEndpoint = (EXTERNAL_HOST && EXTERNAL_HOST !== 'localhost') 
        ? `wss://${EXTERNAL_HOST}${PUBLIC_PATH}` 
        : null;
      
      // Validate current address configuration
      const addressConfig: NodeAddressConfig = {
        listenAddresses: ['/ip4/0.0.0.0/tcp/4001', '/ip4/0.0.0.0/tcp/4002/ws'],
        announceAddresses,
        externalHost: EXTERNAL_HOST,
        publicPath: '/libp2p',
      };
      const addressValidation = validateNodeAddresses(addressConfig);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        nodeId: NODE_ID,
        serverIndex: SERVER_INDEX,
        peerId: node?.peerId.toString(),
        multiaddrs: node?.multiaddrs.map(a => a.toString()),
        publicEndpoint: publicEndpoint,
        announceAddresses: announceAddresses,
        isAdvertisingPublicAddress: addressValidation.hasPublicAddress,
        addressValidation: {
          isValid: addressValidation.isValid,
          hasPublicAddress: addressValidation.hasPublicAddress,
          hasInternalAddress: addressValidation.hasInternalAddress,
          warnings: addressValidation.warnings,
        },
        routingTable: info,
        connections: connectionInfo,
        browserClients: clients.size,
        kvEntries: kvStore.size,
        uptime: Date.now() - startTime,
        isBootstrap: IS_BOOTSTRAP,
        crossServerBootstraps: CROSS_SERVER_BOOTSTRAPS ? CROSS_SERVER_BOOTSTRAPS.split(',').map(s => s.trim()) : [],
        overlay: {
          enabled: overlay?.isStarted || false,
          peerId: overlay?.peerId,
        }
      }, null, 2));
    } else if (req.url === '/browser/config') {
      // Browser node configuration endpoint
      // Returns configuration for browser-native libp2p nodes
      const bootstrapPeers: string[] = [];
      const relayNodes: string[] = [];
      const dhtNodes: string[] = [];
      
      // Build bootstrap peer multiaddrs from this node
      if (node?.peerId) {
        const peerId = node.peerId.toString();
        // Add WebSocket multiaddr for browser libp2p connections
        // Use http-path to specify the /libp2p path that nginx routes to libp2p WebSocket port (4002)
        // Note: http-path value should NOT include leading slash (it's added automatically)
        // The /ws path is for thin client JSON API, /libp2p is for native libp2p protocol
        if (EXTERNAL_HOST && EXTERNAL_HOST !== 'localhost') {
          bootstrapPeers.push(`/dns4/${EXTERNAL_HOST}/tcp/443/wss/http-path/libp2p/p2p/${peerId}`);
        }
        // Also add as relay node if circuit relay is enabled
        if (EXTERNAL_HOST && EXTERNAL_HOST !== 'localhost') {
          relayNodes.push(`/dns4/${EXTERNAL_HOST}/tcp/443/wss/http-path/libp2p/p2p/${peerId}`);
        }
      }
      
      // Add connected DHT nodes with their public nginx paths
      // Browser nodes can connect to these via /dht/node-N paths
      if (node && EXTERNAL_HOST && EXTERNAL_HOST !== 'localhost') {
        const routingInfo = node.getRoutingTableInfo();
        // Get peer IDs from routing table and map to their node index
        // DHT nodes are named dht-node-1, dht-node-2, etc. and have paths /dht/node-1, /dht/node-2
        // We need to discover which peer ID maps to which node index
        // For now, include all connected peers - browser will try to connect via DHT discovery
        const connectionInfo = node.getConnectionInfo();
        for (let i = 0; i < Math.min(connectionInfo.connectedPeers.length, 5); i++) {
          const peerId = connectionInfo.connectedPeers[i];
          // Add as additional bootstrap peer via the /libp2p path
          // Note: We can't use /dht/node-N paths because we don't know which peer ID maps to which node
          // Instead, browser will discover these peers through DHT and connect via circuit relay
          dhtNodes.push(peerId);
        }
      }
      
      // Add cross-server bootstrap peers
      if (CROSS_SERVER_BOOTSTRAPS) {
        const crossServerUrls = parseCrossServerBootstraps(CROSS_SERVER_BOOTSTRAPS, EXTERNAL_HOST);
        // Note: We can't include peer IDs here without fetching them
        // Browser nodes will need to discover peer IDs via the /bootstrap/info endpoint
        for (const url of crossServerUrls) {
          try {
            const parsed = new URL(url);
            // Add as potential relay nodes (browser will need to resolve peer IDs)
            relayNodes.push(`/dns4/${parsed.hostname}/tcp/443/wss`);
          } catch {
            // Skip invalid URLs
          }
        }
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        peerIdMode: BROWSER_PEER_ID_MODE,
        bootstrapPeers,
        relayNodes,
        dhtNodes,  // Peer IDs of DHT nodes for discovery
        maxConnections: BROWSER_MAX_CONNECTIONS,
        dhtEnabled: BROWSER_DHT_ENABLED,
        overlayEnabled: BROWSER_OVERLAY_ENABLED,
      }, null, 2));
    } else if (req.url === '/relay/status') {
      // Relay status endpoint for browser nodes to check relay capacity
      // Returns current relay utilization metrics
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        activeReservations: relayReservationsActive,
        maxReservations: RELAY_MAX_RESERVATIONS,
        activeCircuits: relayCircuitsActive,
        maxCircuits: RELAY_MAX_CIRCUITS,
        utilization: relayReservationsActive / RELAY_MAX_RESERVATIONS,
        bytesRelayed: {
          in: relayBytesIn,
          out: relayBytesOut,
        },
        rejectedReservations: relayReservationsRejected,
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
