# Requirements Document

## Introduction

This feature enables browser clients to run full libp2p DHT nodes, participating directly in the P2P network rather than relying on server-side proxies. This hybrid approach supports both thin clients (existing WebSocket-based) and full browser nodes (new WebRTC-based), enabling the network to scale to thousands of browser participants.

## Glossary

- **Browser_Node**: A full libp2p DHT node running in a web browser using WebRTC transport
- **Thin_Client**: The existing WebSocket-based browser client that proxies through server nodes
- **WebRTC_Transport**: libp2p transport layer using WebRTC for browser-to-browser connections
- **Circuit_Relay**: A mechanism for browsers behind NAT to communicate via relay nodes
- **Signaling_Server**: Server that facilitates WebRTC connection establishment between browsers
- **Bootstrap_Node**: Server-side DHT node that helps browsers discover peers
- **Hybrid_Network**: Network supporting both thin clients and full browser nodes simultaneously

## Requirements

### Requirement 1: Browser libp2p Node Creation

**User Story:** As a browser user, I want to run a full libp2p DHT node in my browser, so that I can participate directly in the P2P network without relying on server proxies.

#### Acceptance Criteria

1. THE Browser_Node SHALL initialize a libp2p instance with WebRTC and WebSocket transports
2. WHERE the server configuration specifies persistent IDs, THE Browser_Node SHALL generate and persist a unique peer ID across browser sessions using IndexedDB
3. WHERE the server configuration specifies ephemeral IDs, THE Browser_Node SHALL generate a new unique peer ID for each browser tab/session
4. THE Bootstrap_Node SHALL expose a configuration endpoint that specifies the peer ID mode (persistent or ephemeral)
5. THE Browser_Node SHALL connect to server Bootstrap_Nodes via WebSocket for initial peer discovery
6. THE Browser_Node SHALL participate in the Kademlia DHT as a full peer
7. WHEN the browser tab closes, THE Browser_Node SHALL gracefully disconnect from all peers

### Requirement 2: WebRTC Browser-to-Browser Connectivity

**User Story:** As a browser node operator, I want to connect directly to other browser nodes via WebRTC, so that I can communicate peer-to-peer without server intermediaries.

#### Acceptance Criteria

1. THE Browser_Node SHALL support WebRTC transport for direct browser-to-browser connections
2. WHEN two Browser_Nodes want to connect, THE Signaling_Server SHALL facilitate WebRTC handshake
3. THE Browser_Node SHALL attempt direct connection first before falling back to Circuit_Relay
4. WHEN direct WebRTC connection fails, THE Browser_Node SHALL use Circuit_Relay through server nodes
5. THE Browser_Node SHALL maintain connections to at least 3 other peers when available

### Requirement 3: Circuit Relay for NAT Traversal

**User Story:** As a browser user behind NAT, I want to participate in the network even when direct connections fail, so that network topology doesn't prevent my participation.

#### Acceptance Criteria

1. THE Server_Nodes SHALL act as Circuit_Relay nodes for browsers behind NAT
2. WHEN a Browser_Node cannot establish direct WebRTC connection, THE Browser_Node SHALL request relay through a server node
3. THE Circuit_Relay SHALL support bidirectional message passing between relayed peers
4. THE Browser_Node SHALL periodically attempt to upgrade relayed connections to direct connections
5. THE Circuit_Relay SHALL limit bandwidth per relayed connection to prevent abuse

### Requirement 4: DHT Participation

**User Story:** As a browser node, I want to fully participate in DHT operations, so that I contribute to network resilience and can store/retrieve data directly.

#### Acceptance Criteria

1. THE Browser_Node SHALL maintain a local k-bucket routing table
2. THE Browser_Node SHALL respond to DHT queries from other peers
3. THE Browser_Node SHALL store DHT records when it is among the k-closest nodes to a key
4. WHEN storing data, THE Browser_Node SHALL replicate to k-closest peers including other browser nodes
5. THE Browser_Node SHALL participate in DHT refresh operations to maintain routing table accuracy

### Requirement 5: Overlay Network Integration

**User Story:** As a browser node operator, I want to use the encrypted overlay messaging system, so that I can send end-to-end encrypted messages to any peer.

#### Acceptance Criteria

1. THE Browser_Node SHALL initialize the OverlayNetwork with the browser libp2p instance
2. THE Browser_Node SHALL publish its public key to the DHT for encrypted messaging
3. THE Browser_Node SHALL be able to send encrypted messages to any peer (browser or server)
4. THE Browser_Node SHALL be able to receive and decrypt messages from any peer
5. WHEN a Browser_Node receives an overlay message, THE Browser_Node SHALL route it according to overlay protocol

### Requirement 6: Hybrid Network Compatibility

**User Story:** As a network operator, I want browser nodes and thin clients to coexist seamlessly, so that users can choose their participation level.

#### Acceptance Criteria

1. THE Browser_Node SHALL interoperate with existing server DHT nodes
2. THE Browser_Node SHALL interoperate with Thin_Clients via server nodes
3. THE Thin_Client SHALL be able to send overlay messages to Browser_Nodes
4. THE Browser_Node SHALL be able to send overlay messages to Thin_Clients (via their connected server)
5. THE network SHALL function correctly with any mix of browser nodes, server nodes, and thin clients

### Requirement 7: Browser Node UI

**User Story:** As a browser user, I want a UI to control my browser node, so that I can see network status and manage my participation.

#### Acceptance Criteria

1. THE Browser_UI SHALL display current peer ID and connection status
2. THE Browser_UI SHALL show number of connected peers (browser and server)
3. THE Browser_UI SHALL allow user to toggle between thin client and full node modes
4. THE Browser_UI SHALL display DHT routing table statistics
5. THE Browser_UI SHALL show bandwidth usage (in/out) for the browser node

### Requirement 8: Performance and Resource Management

**User Story:** As a browser user, I want the browser node to be resource-efficient, so that it doesn't degrade my browsing experience.

#### Acceptance Criteria

1. THE Browser_Node SHALL limit maximum concurrent connections to prevent resource exhaustion
2. THE Browser_Node SHALL implement connection pruning when approaching connection limits
3. THE Browser_Node SHALL use IndexedDB for persistent storage of peer information and keys
4. WHEN browser tab becomes inactive (hidden or backgrounded), THE Browser_Node SHALL disconnect from all peers to prevent stale routing entries
5. WHEN browser tab becomes active again, THE Browser_Node SHALL automatically reconnect and rejoin the DHT
6. WHEN the system goes to sleep or loses network connectivity, THE Browser_Node SHALL detect this and disconnect gracefully
7. THE Browser_Node SHALL use the Page Visibility API and Network Information API to detect activity state changes
8. THE Browser_Node SHALL expose configuration options for resource limits

### Requirement 9: Security

**User Story:** As a browser user, I want my browser node to be secure, so that malicious peers cannot compromise my browser.

#### Acceptance Criteria

1. THE Browser_Node SHALL validate all incoming messages against protocol specifications
2. THE Browser_Node SHALL rate-limit incoming connections to prevent DoS attacks
3. THE Browser_Node SHALL use secure random number generation for cryptographic operations
4. THE Browser_Node SHALL not expose internal browser APIs to the P2P network
5. WHEN an invalid message is received, THE Browser_Node SHALL drop the connection and log the event


### Requirement 10: Relay Capacity Management

**User Story:** As a network operator, I want relay capacity to be managed intelligently, so that the network can scale to thousands of browser clients without degradation.

#### Acceptance Criteria

1. THE Server_Node SHALL expose relay capacity metrics (active reservations, active circuits, max capacity)
2. THE Browser_Node SHALL discover multiple relay nodes and select the least loaded one
3. WHEN a relay node reaches capacity, THE relay node SHALL reject new reservations with RESOURCE_LIMIT_EXCEEDED
4. WHEN a Browser_Node receives RESOURCE_LIMIT_EXCEEDED, THE Browser_Node SHALL try alternative relay nodes
5. IF all relay nodes are at capacity, THE Browser_Node SHALL continue operating with directly-connectable peers only
6. THE Browser_Node SHALL periodically attempt to upgrade relayed connections to direct WebRTC connections
7. THE Server_Node SHALL expose a /relay/status endpoint showing current relay utilization

### Requirement 11: Graceful Degradation Under Load

**User Story:** As a browser user, I want the network to degrade gracefully when capacity is reached, so that I can still use available functionality.

#### Acceptance Criteria

1. WHEN relay capacity is exhausted, THE Browser_Node SHALL log a warning and continue with reduced connectivity
2. THE Browser_Node SHALL prioritize direct connections over relayed connections when possible
3. WHEN a relayed connection fails, THE Browser_Node SHALL attempt to find an alternative relay
4. THE Browser_Node SHALL maintain a list of known relay nodes sorted by availability
5. WHEN network capacity is critically low, THE Bootstrap_Node SHALL return a warning in the /browser/config response

### Requirement 12: Relay Metrics and Monitoring

**User Story:** As a network operator, I want visibility into relay usage, so that I can plan capacity and identify issues.

#### Acceptance Criteria

1. THE Server_Node SHALL track and expose: active_reservations, active_circuits, rejected_reservations, bytes_relayed
2. THE Server_Node SHALL expose relay metrics via the existing /metrics endpoint in Prometheus format
3. THE aggregated health endpoint SHALL include total relay capacity and utilization across all servers
4. WHEN relay utilization exceeds 80%, THE monitoring system SHALL generate an alert
5. THE Server_Node SHALL log relay events (reservation created, circuit opened, capacity exceeded)
