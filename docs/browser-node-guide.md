# Browser Node Guide

This guide explains how to use browser-native libp2p nodes to participate directly in the P2P network from a web browser.

## Overview

Browser nodes enable web browsers to run full libp2p DHT nodes using:
- **WebSocket** transport for connections to server nodes
- **WebRTC** transport for direct browser-to-browser connections
- **Circuit Relay** for NAT traversal when direct connections fail

This allows browsers to participate as full DHT peers rather than relying on server-side proxies.

## Quick Start

### Using the Full Node UI

1. Navigate to `/full-node.html` in your browser
2. Click "Start Node" to initialize the browser node
3. The node will automatically:
   - Generate or restore your peer ID
   - Connect to bootstrap servers
   - Join the DHT network
   - Enable encrypted overlay messaging

### Programmatic Usage

```typescript
import { BrowserNode, fetchBrowserConfig } from './browser/browser-node.js';

// Create a browser node with configuration
const node = new BrowserNode({
  bootstrapUrls: ['/dns4/server.example.com/tcp/443/wss/p2p/QmBootstrap...'],
  peerIdMode: 'persistent',  // or 'ephemeral'
  maxConnections: 50,
  enableCircuitRelay: true,
  enableDHT: true,
  enableOverlay: true,
});

// Start the node
await node.start();

// Get current state
const state = node.getState();
console.log(`Peer ID: ${state.peerId}`);
console.log(`Connected peers: ${state.connectedPeers}`);

// Store data in DHT
const key = new TextEncoder().encode('my-key');
const value = new TextEncoder().encode('my-value');
await node.put(key, value);

// Retrieve data from DHT
const retrieved = await node.get(key);

// Send encrypted message to another peer
const response = await node.sendMessage(targetPeerId, payload);

// Stop the node
await node.stop();
```

### Using Server Configuration

```typescript
import { createBrowserNodeFromConfig } from './browser/browser-node.js';

// Fetch configuration from server and create node
const node = await createBrowserNodeFromConfig('https://server.example.com');
await node.start();
```

## Configuration Options

### BrowserNodeConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `bootstrapUrls` | `string[]` | Required | WebSocket URLs of bootstrap server nodes |
| `peerIdMode` | `'persistent' \| 'ephemeral'` | Required | How peer IDs are managed |
| `maxConnections` | `number` | `50` | Maximum concurrent connections |
| `enableCircuitRelay` | `boolean` | `true` | Enable circuit relay for NAT traversal |
| `enableDHT` | `boolean` | `true` | Enable DHT participation |
| `enableOverlay` | `boolean` | `true` | Enable encrypted overlay messaging |

### Peer ID Modes

**Persistent Mode**
- Peer ID is stored in IndexedDB
- Same ID is used across browser sessions
- Useful for maintaining identity in the network

**Ephemeral Mode**
- New peer ID generated for each tab/session
- No data persisted to storage
- Useful for privacy or testing

## State Management

Monitor node state changes:

```typescript
node.onStateChange((state) => {
  console.log('Status:', state.status);
  console.log('Connected peers:', state.connectedPeers);
  console.log('Browser peers:', state.browserPeers);
  console.log('Server peers:', state.serverPeers);
  console.log('Bytes in/out:', state.bytesIn, state.bytesOut);
});
```

### State Properties

| Property | Type | Description |
|----------|------|-------------|
| `status` | `'disconnected' \| 'connecting' \| 'connected' \| 'inactive'` | Current connection status |
| `peerId` | `string \| null` | Local peer ID |
| `connectedPeers` | `number` | Total connected peers |
| `browserPeers` | `number` | Peers connected via WebRTC |
| `serverPeers` | `number` | Peers connected via WebSocket |
| `routingTableSize` | `number` | DHT routing table entries |
| `bytesIn` | `number` | Total bytes received |
| `bytesOut` | `number` | Total bytes sent |

## DHT Operations

### Store Data

```typescript
const key = new TextEncoder().encode('my-key');
const value = new TextEncoder().encode('my-value');
await node.put(key, value);
```

### Retrieve Data

```typescript
const key = new TextEncoder().encode('my-key');
try {
  const value = await node.get(key);
  console.log('Value:', new TextDecoder().decode(value));
} catch (error) {
  console.log('Key not found');
}
```

### Find Closest Peers

```typescript
const key = new TextEncoder().encode('some-key');
for await (const peer of node.getClosestPeers(key)) {
  console.log('Peer:', peer.id);
  console.log('Addresses:', peer.multiaddrs);
}
```

## Overlay Messaging

Send end-to-end encrypted messages to any peer:

```typescript
// Register message handler
node.onMessage(async (payload, context) => {
  console.log('Message from:', context.originPeerId);
  console.log('Message ID:', context.messageId);
  
  // Process payload and return response
  return new TextEncoder().encode('response');
});

// Send message
const targetPeerId = '12D3KooW...';
const payload = new TextEncoder().encode('hello');
const response = await node.sendMessage(targetPeerId, payload);
```

## Activity Monitoring

Browser nodes automatically handle tab visibility:

- **Tab becomes inactive**: Node disconnects from all peers to prevent stale routing entries
- **Tab becomes active**: Node automatically reconnects and rejoins the DHT
- **Network offline**: Node gracefully disconnects
- **Network online**: Node automatically reconnects

This behavior can be observed through state changes:

```typescript
node.onStateChange((state) => {
  if (state.status === 'inactive') {
    console.log('Tab inactive - disconnected');
  } else if (state.status === 'connected') {
    console.log('Connected to network');
  }
});
```

## Relay Management

When direct WebRTC connections fail (due to NAT), the node automatically uses circuit relay:

1. Node discovers relay nodes from DHT or configuration
2. Selects the least loaded relay
3. If relay is at capacity, tries alternative relays
4. Falls back to direct-only mode if all relays are full

Monitor relay events:

```typescript
const relaySelector = node.getRelaySelector?.();
relaySelector?.onEvent((event) => {
  switch (event.type) {
    case 'relay-selected':
      console.log('Using relay:', event.peerId);
      break;
    case 'all-relays-full':
      console.log('All relays at capacity');
      break;
    case 'degraded-mode':
      console.log('Operating with direct peers only');
      break;
  }
});
```

## Connection Upgrade

Relayed connections are periodically upgraded to direct connections when possible:

```typescript
const upgrader = node.getConnectionUpgrader();

upgrader.onEvent((event) => {
  switch (event.type) {
    case 'upgrade-success':
      console.log(`Upgraded to ${event.newTransport} for ${event.peerId}`);
      break;
    case 'upgrade-failed':
      console.log(`Upgrade failed: ${event.error}`);
      break;
  }
});
```

## Troubleshooting

### Node won't connect

1. **Check bootstrap URLs**: Ensure the WebSocket URLs are correct and servers are running
2. **Check browser console**: Look for connection errors
3. **Verify network**: Ensure you have internet connectivity
4. **Check firewall**: WebSocket connections may be blocked

### WebRTC connections failing

1. **NAT issues**: The node will automatically fall back to circuit relay
2. **STUN servers**: Default Google STUN servers are used; ensure they're accessible
3. **Browser support**: Verify WebRTC is supported in your browser

### Peer ID not persisting

1. **Private browsing**: IndexedDB is not available in private/incognito mode
2. **Storage quota**: Browser may have cleared storage
3. **Mode setting**: Ensure `peerIdMode: 'persistent'` is set

### High memory usage

1. **Reduce maxConnections**: Lower the connection limit
2. **Check for leaks**: Ensure you call `stop()` when done
3. **Monitor state**: Use `getState()` to check connection counts

### Messages not delivering

1. **Check overlay enabled**: Ensure `enableOverlay: true`
2. **Verify peer online**: Target peer must be connected to network
3. **Check public key**: Peer's public key must be published to DHT

### Rate limiting

The node implements rate limiting for security:
- Max 10 connections per second
- Max 100 messages per second
- Max 30 relay requests per minute

If you're being rate limited, reduce request frequency.

## Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| WebRTC | ✅ | ✅ | ✅ | ✅ |
| WebSocket | ✅ | ✅ | ✅ | ✅ |
| IndexedDB | ✅ | ✅ | ✅ | ✅ |
| Page Visibility API | ✅ | ✅ | ✅ | ✅ |
| Network Information API | ✅ | ⚠️ Partial | ❌ | ✅ |

Note: For browsers without Network Information API, connection errors are used for detection.

## Security Considerations

- All overlay messages are end-to-end encrypted
- Peer IDs are cryptographically generated
- Invalid messages cause connection drops
- Rate limiting prevents DoS attacks
- Private keys never leave the browser

## API Reference

### BrowserNode

```typescript
class BrowserNode {
  constructor(config: BrowserNodeConfig);
  
  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;
  
  // State
  getState(): BrowserNodeState;
  onStateChange(callback: (state: BrowserNodeState) => void): () => void;
  getPeerId(): string | null;
  getConnectionCount(): number;
  isAtConnectionLimit(): boolean;
  
  // DHT
  put(key: Uint8Array, value: Uint8Array): Promise<void>;
  get(key: Uint8Array): Promise<Uint8Array>;
  getClosestPeers(key: Uint8Array): AsyncIterable<PeerInfo>;
  
  // Messaging
  sendMessage(targetPeerId: string, payload: Uint8Array): Promise<Uint8Array>;
  onMessage(handler: MessageHandler): void;
  
  // Advanced
  getLibp2pNode(): Libp2p;
  getOverlayNetwork(): OverlayNetwork | null;
  getConnectionUpgrader(): ConnectionUpgrader;
}
```

### Helper Functions

```typescript
// Fetch configuration from server
fetchBrowserConfig(serverUrl: string): Promise<BrowserConfigResponse>;

// Create node from server configuration
createBrowserNodeFromConfig(serverUrl: string): Promise<BrowserNode>;
```
