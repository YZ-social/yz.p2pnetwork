# Requirements Document

## Introduction

This specification addresses a critical peer discovery issue where DHT nodes advertise internal Docker addresses instead of public nginx addresses. This prevents browser nodes and external clients from connecting to discovered peers, as they can only reach nodes via the public WSS endpoints.

The fix ensures all nodes (bootstrap, DHT nodes) properly advertise their public addresses so that any peer discovering them through the DHT can actually connect.

## Glossary

- **PublicAddress**: A multiaddr reachable from the public internet via nginx (e.g., `wss://imeyouwe.com/dht/node-1`)
- **InternalAddress**: A Docker network address only reachable within the Docker network (e.g., `172.18.0.5:4001`)
- **AnnounceAddress**: The address a node advertises to other peers for incoming connections
- **ServerNode**: A DHT node running on a server (in Docker), capable of accepting incoming connections via nginx
- **DHTNode**: A Kademlia DHT participant (can be server or browser)
- **BootstrapNode**: The initial connection point for new peers joining the network (a type of ServerNode)
- **BrowserNode**: A libp2p node running in a web browser, behind NAT, using WebRTC and circuit relay
- **HttpPath**: A multiaddr component that encodes URL path for nginx routing
- **CircuitRelay**: A protocol allowing NAT-ed nodes to communicate through a relay server

## Requirements

### Requirement 1: Server Node Public Address Configuration

**User Story:** As a network operator, I want all server-side DHT nodes (Docker containers) to advertise their public nginx addresses, so that any peer can connect to them regardless of network topology.

#### Acceptance Criteria

1. WHEN a server-side DHT node starts, THE ServerNode SHALL configure its announce address as the public nginx WSS endpoint
2. THE ServerNode SHALL use the format `/dns4/{host}/tcp/443/wss/http-path/{path}` for announce addresses
3. THE ServerNode SHALL NOT include the `/p2p/{peerId}` suffix in configured announce addresses (libp2p appends it automatically)
4. THE ServerNode SHALL NOT advertise any internal Docker network addresses (172.x.x.x, 10.x.x.x, 192.168.x.x)
5. THE ServerNode SHALL NOT advertise localhost or 127.0.0.1 addresses

### Requirement 1b: Browser Node Address Handling

**User Story:** As a browser node operator, I want browser nodes to use appropriate transports for their environment, so that they can participate in the DHT network.

#### Acceptance Criteria

1. WHEN a browser node starts, THE BrowserNode SHALL NOT configure static announce addresses (browsers are behind NAT)
2. THE BrowserNode SHALL use WebRTC for browser-to-browser connections
3. THE BrowserNode SHALL use circuit relay through server nodes for NAT traversal
4. THE BrowserNode SHALL connect to server nodes via their public WSS addresses
5. WHEN a browser node receives peer addresses from DHT, THE BrowserNode SHALL filter for addresses it can dial (WSS or WebRTC)

### Requirement 2: Bootstrap Node Address Advertisement

**User Story:** As a browser client, I want the bootstrap node to advertise its public address, so that I can discover and connect to it.

#### Acceptance Criteria

1. WHEN the bootstrap node starts, THE BootstrapNode SHALL configure its announce address as `/dns4/{EXTERNAL_HOST}/tcp/443/wss/http-path/libp2p`
2. WHEN responding to DHT queries, THE BootstrapNode SHALL include only its public address in peer info
3. THE BootstrapNode SHALL use `withAnnounceAddresses()` at configuration time, not `addObservedAddr()` after start

### Requirement 3: DHT Node Address Advertisement

**User Story:** As a browser client discovering peers through the DHT, I want to receive public addresses that I can actually connect to.

#### Acceptance Criteria

1. WHEN a DHT node starts, THE DHTNode SHALL configure its announce address based on its NODE_INDEX
2. THE DHTNode SHALL use the format `/dns4/{EXTERNAL_HOST}/tcp/443/wss/http-path/dht%2Fnode-{NODE_INDEX}` for its announce address
3. WHEN responding to DHT peer queries, THE DHTNode SHALL return only public addresses for known peers
4. THE DHTNode SHALL filter out any internal addresses before sharing peer information

### Requirement 4: Peer Discovery Returns Connectable Addresses

**User Story:** As a browser node, I want DHT peer discovery to return addresses I can actually connect to, so that I can build connections to multiple peers.

#### Acceptance Criteria

1. WHEN a browser node queries for closest peers, THE DHT SHALL return peers with public WSS addresses
2. WHEN a browser node receives peer addresses, THE BrowserNode SHALL be able to dial those addresses successfully
3. FOR ALL peers returned by DHT queries, each peer SHALL have at least one public WSS address
4. THE BrowserNode SHALL connect to at least 3 peers after successful bootstrap (not just the bootstrap node)

### Requirement 5: Internal Bootstrap with Public Advertisement

**User Story:** As a Docker node, I want to bootstrap via internal Docker DNS but advertise my public address, so that I can efficiently join the network while remaining publicly accessible.

#### Acceptance Criteria

1. WHEN a DHT node bootstraps, THE DHTNode MAY use internal Docker addresses for initial connection to the bootstrap node
2. AFTER bootstrapping, THE DHTNode SHALL only share its public announce address with other peers
3. WHEN the bootstrap node shares peer information, THE BootstrapNode SHALL translate internal addresses to public addresses
4. THE DHTNode SHALL maintain a mapping between internal peer connections and their public addresses

### Requirement 6: Address Validation

**User Story:** As a network operator, I want to verify that nodes are advertising correct addresses, so that I can diagnose connectivity issues.

#### Acceptance Criteria

1. WHEN querying a node's /info endpoint, THE DHTNode SHALL return its configured announce addresses
2. THE /info endpoint SHALL indicate whether the node is advertising public or internal addresses
3. WHEN a node detects it's advertising internal addresses in production, THE DHTNode SHALL log a warning
4. THE DHTNode SHALL provide a health check that validates announce address configuration
