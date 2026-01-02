# Requirements Document: Public DHT Node Infrastructure

## Introduction

This document specifies the requirements for making Docker-hosted DHT nodes fully accessible as part of a public DHT network. The oracle-yz server will host ~60 stable DHT nodes that serve as reliable infrastructure for a larger network of 1000's of mobile and desktop clients.

All nodes (both Docker-hosted and external clients) must use and advertise public addresses exclusively. This ensures that any node can connect to any other node regardless of network location.

## Problem Statement

Current issues:
- Docker nodes only have private addresses (172.18.x.x) which are unreachable from external clients
- Only the bootstrap node is publicly accessible
- External clients (phones, computers) cannot discover or connect to the 60 Docker DHT nodes
- The Docker nodes provide no value to the public DHT network in their current state

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Public DHT Network                            │
│                                                                      │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│   │  Phone   │  │  Phone   │  │ Computer │  │ Computer │           │
│   │  Client  │  │  Client  │  │  Client  │  │  Client  │           │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│        │             │             │             │                  │
│        └─────────────┴──────┬──────┴─────────────┘                  │
│                             │                                        │
│              All connect via public addresses:                       │
│              wss://imeyouwe.com/dht/node-1                          │
│              wss://imeyouwe.com/dht/node-2                          │
│              wss://imeyouwe.com/dht/node-N                          │
│                             │                                        │
│                    ┌────────▼────────┐                              │
│                    │   oracle-yz     │                              │
│                    │   nginx proxy   │                              │
│                    │                 │                              │
│                    │  Routes to 60   │                              │
│                    │  Docker nodes   │                              │
│                    └─────────────────┘                              │
└─────────────────────────────────────────────────────────────────────┘
```

## Glossary

- **Public_Address**: A globally routable address that any client on the internet can connect to
- **Announce_Address**: The address a node advertises to other peers for incoming connections
- **Listen_Address**: The address a node binds to locally for accepting connections
- **nginx_Proxy**: Reverse proxy that routes external requests to internal Docker containers
- **DHT_Node**: A node participating in the Kademlia DHT network
- **Bootstrap_Node**: The initial entry point for new nodes joining the network

## Requirements

### Requirement 1: Public Address Assignment

**User Story:** As a DHT network operator, I want each Docker node to have a unique public address, so that external clients can discover and connect to any node.

#### Acceptance Criteria

1. WHEN a DHT node starts THEN IT SHALL be assigned a unique public address path (e.g., `/dht/node-1`)
2. THE public address SHALL be in the format `wss://imeyouwe.com/dht/{node-id}`
3. EACH node SHALL advertise ONLY its public address (no private 172.x.x.x addresses)
4. THE node's `announceAddresses` configuration SHALL contain only the public WSS address
5. THE node's `listenAddresses` SHALL bind to the container's internal port

### Requirement 2: nginx Routing Configuration

**User Story:** As a system administrator, I want nginx to route requests to the correct Docker container, so that each node's public address resolves to the correct backend.

#### Acceptance Criteria

1. WHEN a request arrives at `/dht/node-N` THEN nginx SHALL proxy it to the corresponding container
2. nginx SHALL support WebSocket upgrade for libp2p connections
3. nginx SHALL handle TLS termination (WSS → WS internally)
4. WHEN the source is from the Docker network THEN nginx MAY optimize routing directly to the container
5. nginx configuration SHALL be dynamically generated based on the number of nodes

### Requirement 3: Node Discovery and Connectivity

**User Story:** As a mobile/desktop client, I want to discover and connect to any DHT node, so that I can participate in the distributed network.

#### Acceptance Criteria

1. WHEN an external client queries the DHT THEN IT SHALL receive public addresses for discovered nodes
2. WHEN an external client connects to a node's public address THEN the connection SHALL succeed
3. WHEN a Docker node connects to another Docker node THEN IT SHALL use the public address
4. ALL peer discovery SHALL return only public addresses (using default `removePrivateAddressesMapper`)

### Requirement 4: Internal Node Communication

**User Story:** As a Docker node, I want to communicate with other Docker nodes efficiently, so that internal DHT operations are fast.

#### Acceptance Criteria

1. WHEN a Docker node connects to another Docker node's public address THEN nginx SHALL route efficiently
2. THE connection SHALL succeed even though both nodes are on the same Docker network
3. Internal node-to-node latency SHALL be acceptable for DHT operations (<100ms)

### Requirement 5: Bootstrap and Network Join

**User Story:** As a new client joining the network, I want to bootstrap from any public node, so that I can discover the rest of the network.

#### Acceptance Criteria

1. ANY public node address SHALL be usable as a bootstrap peer
2. WHEN a client bootstraps THEN IT SHALL discover other public nodes via DHT queries
3. THE bootstrap node (`/dht/bootstrap` or `/ws`) SHALL remain as the primary entry point
4. ALL 60 Docker nodes SHALL be discoverable after bootstrapping

### Requirement 6: Scalability

**User Story:** As a network operator, I want to easily scale the number of Docker nodes, so that I can adjust capacity as needed.

#### Acceptance Criteria

1. THE system SHALL support configuring 1-100 DHT nodes
2. WHEN nodes are added THEN nginx configuration SHALL be updated automatically
3. WHEN nodes are removed THEN their routes SHALL be removed from nginx
4. THE deploy script SHALL accept a parameter for the number of nodes

### Requirement 7: Health and Monitoring

**User Story:** As a network operator, I want to monitor the health of all nodes, so that I can ensure network reliability.

#### Acceptance Criteria

1. EACH node SHALL expose a health endpoint at its public address
2. nginx SHALL support health checks for upstream containers
3. THE system SHALL provide metrics for connection counts per node
4. WHEN a node is unhealthy THEN IT SHALL be excluded from load balancing (if applicable)

## Implementation Notes

### Address Configuration

Each Docker node needs:
```typescript
// Listen on internal port
listenAddresses: ['/ip4/0.0.0.0/tcp/4001/ws']

// Advertise public address ONLY
announceAddresses: [`/dns4/imeyouwe.com/tcp/443/wss/p2p-webrtc-star/p2p/${peerId}`]
// Or simpler path-based:
announceAddresses: [`/dns4/imeyouwe.com/tcp/443/tls/ws/p2p/${peerId}`]
```

### nginx Configuration Pattern

```nginx
# For each node
location /dht/node-1 {
    proxy_pass http://dht-node-1:4001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

### Docker Compose Pattern

```yaml
dht-node-1:
  environment:
    - NODE_ID=node-1
    - PUBLIC_PATH=/dht/node-1
    - EXTERNAL_HOST=imeyouwe.com
```

## Success Criteria

1. External client can connect to any of the 60 nodes via public address
2. Docker nodes can discover and connect to each other via public addresses
3. DHT queries return only public addresses (no 172.x.x.x)
4. Encrypted overlay echo works between any two nodes (internal or external)
5. Mobile/desktop clients can bootstrap and discover all 60 nodes
6. System scales to 60+ nodes without manual nginx configuration
