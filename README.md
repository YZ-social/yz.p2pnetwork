# yz.p2pnetwork

A hybrid P2P network implementation using libp2p, supporting both server nodes and browser-native nodes.

## Features

- **Kademlia DHT**: Distributed hash table for peer discovery and data storage
- **Browser Nodes**: Full libp2p DHT participation from web browsers
- **Hybrid Architecture**: Seamless interoperability between server nodes, browser nodes, and thin clients
- **Encrypted Overlay Messaging**: End-to-end encrypted communication between any peers
- **Circuit Relay**: NAT traversal for browsers behind firewalls

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           HYBRID P2P NETWORK                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    WebRTC     ┌──────────────┐    WebRTC    ┌──────────┐ │
│  │ Browser Node │◄────────────►│ Browser Node │◄────────────►│ Browser  │ │
│  │   (Full)     │              │   (Full)     │              │  Node    │ │
│  └──────┬───────┘              └──────┬───────┘              └────┬─────┘ │
│         │                             │                           │       │
│         │ WebSocket                   │ WebSocket                 │       │
│         │                             │                           │       │
│  ┌──────▼───────┐              ┌──────▼───────┐              ┌────▼─────┐ │
│  │ Server Node  │◄────────────►│ Server Node  │◄────────────►│ Server   │ │
│  │ (Bootstrap)  │   libp2p     │   (DHT)      │   libp2p     │  Node    │ │
│  └──────┬───────┘              └──────────────┘              └──────────┘ │
│         │                                                                  │
│         │ WebSocket (thin client)                                         │
│         │                                                                  │
│  ┌──────▼───────┐                                                         │
│  │ Thin Client  │  (no libp2p, just WebSocket API)                        │
│  │  (Browser)   │                                                         │
│  └──────────────┘                                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Node Types

### Server Nodes
Full libp2p nodes running on servers that:
- Participate in the Kademlia DHT
- Act as bootstrap nodes for browser clients
- Provide circuit relay for NAT traversal
- Expose WebSocket endpoints for browser connections

### Browser Nodes
Full libp2p nodes running in web browsers that:
- Connect to servers via WebSocket for bootstrap
- Connect to other browsers via WebRTC
- Participate fully in the DHT
- Use circuit relay when direct connections fail
- Support encrypted overlay messaging

### Thin Clients
Lightweight browser clients that:
- Connect to a single server via WebSocket
- Proxy all DHT operations through the server
- Suitable for low-resource scenarios

## Quick Start

### Running Server Nodes

```bash
# Install dependencies
npm install

# Start a server node
npm run start:node

# Or use Docker
docker-compose up
```

### Using Browser Nodes

Navigate to `/full-node.html` in your browser to run a full browser node, or use programmatically:

```typescript
import { BrowserNode } from './browser/browser-node.js';

const node = new BrowserNode({
  bootstrapUrls: ['/dns4/server.example.com/tcp/443/wss/p2p/QmBootstrap...'],
  peerIdMode: 'persistent',
  maxConnections: 50,
});

await node.start();

// Store data in DHT
await node.put(key, value);

// Retrieve data
const data = await node.get(key);

// Send encrypted message
const response = await node.sendMessage(targetPeerId, payload);
```

See [Browser Node Guide](docs/browser-node-guide.md) for detailed documentation.

## Hybrid Network Compatibility

The network supports seamless communication between all node types:

| From / To | Server Node | Browser Node | Thin Client |
|-----------|-------------|--------------|-------------|
| Server Node | ✅ Direct | ✅ WebSocket | ✅ WebSocket |
| Browser Node | ✅ WebSocket | ✅ WebRTC/Relay | ✅ Via Server |
| Thin Client | ✅ WebSocket | ✅ Via Server | ✅ Via Server |

## Project Structure

```
src/
├── browser/          # Browser node implementation
│   ├── browser-node.ts
│   ├── peer-id-manager.ts
│   ├── activity-monitor.ts
│   ├── transport-config.ts
│   ├── relay-selector.ts
│   └── security.ts
├── cli/              # Server node CLI
├── dht/              # DHT implementation
├── overlay/          # Encrypted messaging overlay
└── integration/      # Integration tests

public/
├── index.html        # Thin client UI
└── full-node.html    # Full browser node UI

docs/
└── browser-node-guide.md
```

## Configuration

### Server Configuration

Server nodes expose a `/browser/config` endpoint that provides:
- Peer ID mode (persistent/ephemeral)
- Bootstrap peer addresses
- Relay node addresses
- Connection limits

### Browser Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `peerIdMode` | - | `'persistent'` or `'ephemeral'` |
| `maxConnections` | `50` | Maximum concurrent connections |
| `enableCircuitRelay` | `true` | Enable NAT traversal |
| `enableDHT` | `true` | Enable DHT participation |
| `enableOverlay` | `true` | Enable encrypted messaging |

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run integration tests
npm run test:integration

# Build
npm run build

# Start development server
npm run dev
```

## Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| WebRTC | ✅ | ✅ | ✅ | ✅ |
| WebSocket | ✅ | ✅ | ✅ | ✅ |
| IndexedDB | ✅ | ✅ | ✅ | ✅ |

## License

See [LICENSE](LICENSE) for details.
