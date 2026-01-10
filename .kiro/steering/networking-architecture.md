# Networking Architecture Principles

## Public Address Policy

**CRITICAL: All DHT nodes MUST advertise and use ONLY public addresses.**

### Core Principle

Every node in the network (Docker containers, browser nodes, mobile clients, desktop clients) must:

1. **Advertise only public addresses** - Never advertise internal Docker IPs (172.x.x.x), localhost, or private network addresses
2. **Connect via public addresses** - Even Docker containers on the same server must connect to each other through the public nginx endpoints
3. **Use nginx for all routing** - nginx handles path-based routing to the correct container

### Address Format

All nodes use the `http-path` multiaddr component for nginx routing:

```
/dns4/{hostname}/tcp/443/wss/http-path/{path}/p2p/{peerId}
```

Examples:
- Bootstrap: `/dns4/imeyouwe.com/tcp/443/wss/http-path/libp2p/p2p/{peerId}`
- DHT Node 1: `/dns4/imeyouwe.com/tcp/443/wss/http-path/dht%2Fnode-1/p2p/{peerId}`
- DHT Node 5: `/dns4/imeyouwe.com/tcp/443/wss/http-path/dht%2Fnode-5/p2p/{peerId}`

### Why This Matters

1. **Browser compatibility** - Browsers can only connect via WSS to public endpoints
2. **Uniform addressing** - All clients (phones, browsers, desktops) use the same addresses
3. **NAT traversal** - Public addresses work regardless of network topology
4. **DHT consistency** - Peers share addresses that all other peers can actually reach

### Implementation Requirements

When implementing or modifying DHT node code:

1. **Configure announce addresses at node creation** using `withAnnounceAddresses()` 
2. **Do NOT use `addObservedAddr()`** - it doesn't properly propagate to DHT responses
3. **Announce addresses should NOT include `/p2p/{peerId}`** - libp2p appends it automatically
4. **Internal Docker connections are only for initial bootstrap** - after that, use public addresses
5. **Use custom WebSocket transport** - The standard `@libp2p/websockets` transport doesn't recognize `http-path`. Both server nodes (`src/dht/factory.ts`) and browser nodes (`src/browser/websocket-transport.ts`) must use `webSocketsWithHttpPath()` which accepts multiaddrs with the `http-path` component.

### Custom WebSocket Transport

The `http-path` multiaddr component is not recognized by the standard libp2p WebSocket transport. Without a custom transport, nodes get `NoValidAddressesError` when trying to dial peers via public addresses.

```typescript
// In src/dht/factory.ts - Server nodes
function webSocketsWithHttpPath(): ReturnType<typeof webSockets> {
  const baseTransport = webSockets();
  return (components) => {
    const transport = baseTransport(components);
    // Override dialFilter to accept http-path multiaddrs
    transport.dialFilter = (multiaddrs) => {
      // Accept any multiaddr containing /ws/ or /wss/
      return multiaddrs.filter(ma => {
        const str = ma.toString();
        return str.includes('/ws/') || str.includes('/wss/');
      });
    };
    return transport;
  };
}
```

### nginx Routing

nginx routes based on URL path:
- `/ws` → bootstrap node (thin client API)
- `/libp2p` → bootstrap node (libp2p protocol)
- `/dht/node-N` → DHT node N

All WebSocket connections go through nginx on port 443 with TLS termination.

## Deployment

The production server is `oracle-yz`. Deploy using git, not the deploy.sh script.

### Deployment Steps

```bash
# SSH to server and pull latest code
ssh oracle-yz "cd /home/ubuntu/libp2p-dht && git pull"

# Rebuild and restart containers
ssh oracle-yz "cd /home/ubuntu/libp2p-dht && docker compose build && docker compose down && docker compose up -d"

# Or use the helper script
ssh oracle-yz "cd /home/ubuntu/libp2p-dht && ./scripts/DockerServerRestart.sh"
```

### Verification Endpoints

After deployment, verify the fix by checking:
- Bootstrap info: `https://imeyouwe.com/bootstrap/info`
- DHT node info: `https://imeyouwe.com/dht/node-1/info`

The `/info` endpoints should show:
- `announceAddresses` with public WSS addresses (not internal Docker IPs)
- `isAdvertisingPublicAddress: true`
- `addressValidation.isValid: true`
