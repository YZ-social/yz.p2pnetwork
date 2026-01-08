# Implementation Plan: Browser-Native libp2p Nodes

## Overview

This plan implements browser-native libp2p nodes with WebRTC transport, enabling browsers to participate as full DHT peers. The implementation supports both thin clients (existing) and full browser nodes (new) in a hybrid architecture.

## Tasks

- [x] 1. Core Browser Node Infrastructure
  - [x] 1.1 Create src/browser/types.ts
    - Define BrowserNodeConfig interface
    - Define BrowserNodeState interface
    - Define RelayNodeInfo interface
    - _Requirements: 1.1, 10.1_
  - [x] 1.2 Create src/browser/peer-id-manager.ts
    - Implement PeerIdManager class
    - Support persistent mode (IndexedDB storage)
    - Support ephemeral mode (new ID per session)
    - _Requirements: 1.2, 1.3_
  - [x] 1.3 Write property test for peer ID modes
    - **Property 1: Peer ID Mode Consistency**
    - Test persistent IDs survive restart
    - Test ephemeral IDs are unique per session
    - **Validates: Requirements 1.2, 1.3**
  - [x] 1.4 Create src/browser/storage.ts
    - Implement IndexedDB wrapper for browser storage
    - Support identity, peers, and dht-records object stores
    - Handle private browsing mode fallback
    - _Requirements: 8.3_

- [x] 2. Activity Monitoring
  - [x] 2.1 Create src/browser/activity-monitor.ts
    - Implement ActivityMonitor class
    - Use Page Visibility API for tab state
    - Use Network Information API where available
    - Implement grace period before disconnect
    - _Requirements: 8.4, 8.5, 8.6, 8.7_
  - [x] 2.2 Write property test for activity state transitions
    - **Property 3: Activity State Transitions**
    - Test inactive → disconnect → active → reconnect flow
    - **Validates: Requirements 8.4, 8.5**
  - [x] 2.3 Write unit tests for activity monitor
    - Test visibility change detection
    - Test network state detection
    - Test grace period timing
    - _Requirements: 8.4, 8.5, 8.6_

- [x] 3. Checkpoint - Verify core infrastructure
  - Ensure TypeScript compiles without errors
  - Ensure unit tests pass
  - Ask the user if questions arise

- [x] 4. Transport Configuration
  - [x] 4.1 Create src/browser/transport-config.ts
    - Configure WebSocket transport for server connections
    - Configure WebRTC transport for browser-to-browser
    - Configure circuit relay transport for NAT traversal
    - _Requirements: 2.1, 2.2, 3.1_
  - [x] 4.2 Write property test for connection strategy
    - **Property 2: Connection Strategy Ordering**
    - Test direct WebRTC attempted before relay
    - **Validates: Requirements 2.3, 2.4**

- [x] 5. Relay Management
  - [x] 5.1 Create src/browser/relay-selector.ts
    - Implement RelaySelector class
    - Discover relay nodes from DHT
    - Select least loaded relay
    - Handle RESOURCE_LIMIT_EXCEEDED with retry
    - _Requirements: 10.2, 10.3, 10.4_
  - [x] 5.2 Write property test for relay failover
    - **Property 13: Relay Failover**
    - Test retry on RESOURCE_LIMIT_EXCEEDED
    - **Validates: Requirements 10.4, 11.3**
  - [x] 5.3 Write property test for graceful degradation
    - **Property 14: Graceful Degradation**
    - Test continued operation when all relays full
    - **Validates: Requirements 10.5, 11.1**

- [x] 6. Browser Node Class
  - [x] 6.1 Create src/browser/browser-node.ts
    - Implement BrowserNode class
    - Integrate PeerIdManager, ActivityMonitor, RelaySelector
    - Implement start/stop lifecycle
    - Implement DHT operations (put, get, getClosestPeers)
    - _Requirements: 1.1, 1.5, 1.6, 1.7, 4.1, 4.2_
  - [x] 6.2 Write property test for graceful disconnect
    - **Property 8: Graceful Disconnect on Tab Close**
    - Test all connections closed on stop()
    - **Validates: Requirements 1.7**
  - [x] 6.3 Write property test for connection limits
    - **Property 7: Connection Limit Enforcement**
    - Test maxConnections is enforced
    - **Validates: Requirements 8.1, 8.2**

- [x] 7. Checkpoint - Verify browser node core
  - Ensure BrowserNode can start and stop
  - Ensure DHT operations work
  - Ask the user if questions arise

- [x] 8. Overlay Integration
  - [x] 8.1 Integrate OverlayNetwork with BrowserNode
    - Initialize overlay with browser libp2p instance
    - Publish public key to DHT on start
    - Register message handlers
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x] 8.2 Write property test for overlay message delivery
    - **Property 5: Overlay Message Delivery**
    - Test messages deliverable between browser nodes
    - **Validates: Requirements 5.3, 5.4**
  - [x] 8.3 Write property test for public key publication
    - **Property 11: Public Key Publication**
    - Test public key retrievable from DHT after start
    - **Validates: Requirements 5.2**

- [-] 9. Hybrid Network Compatibility
  - [x] 9.1 Test browser-to-server interoperability
    - Verify browser nodes can query server DHT nodes
    - Verify server nodes can query browser DHT nodes
    - _Requirements: 6.1_
  - [x] 9.2 Test thin client to browser node messaging
    - Verify thin clients can send overlay messages to browser nodes
    - Verify browser nodes can send to thin clients via server
    - _Requirements: 6.2, 6.3, 6.4_
  - [x] 9.3 Write property test for hybrid interoperability
    - **Property 6: Hybrid Network Interoperability**
    - Test cross-type messaging works
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

- [x] 10. Server-Side Updates
  - [x] 10.1 Add /browser/config endpoint to ws-bridge.ts
    - Return peerIdMode, bootstrapPeers, relayNodes, maxConnections
    - _Requirements: 1.4_
  - [x] 10.2 Add /relay/status endpoint to server nodes
    - Return activeReservations, maxReservations, activeCircuits
    - _Requirements: 10.1, 10.7_
  - [x] 10.3 Add relay metrics to /metrics endpoint
    - Add relay_reservations_active, relay_circuits_active, etc.
    - _Requirements: 12.1, 12.2_
  - [x] 10.4 Write property test for relay capacity enforcement
    - **Property 12: Relay Capacity Enforcement**
    - Test maxReservations is enforced
    - **Validates: Requirements 10.1, 10.3**

- [x] 11. Checkpoint - Verify server updates
  - Ensure new endpoints work
  - Ensure relay metrics are exposed
  - Ask the user if questions arise

- [x] 12. Browser UI
  - [x] 12.1 Create public/full-node.html
    - Add mode toggle (thin client vs full node)
    - Display peer ID and connection status
    - Show connected peers (browser vs server count)
    - Display DHT routing table stats
    - Show bandwidth usage
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [x] 12.2 Add relay status display to UI
    - Show current relay node (if using relay)
    - Show relay utilization
    - _Requirements: 10.7, 12.3_
  - [x] 12.3 Add Playwright browser tests
    - Create e2e/full-node-ui.spec.ts with 36 tests
    - Test page structure and layout
    - Test status bar elements (peer ID, connection status, peer counts)
    - Test mode toggle functionality
    - Test DHT routing table display
    - Test bandwidth usage display
    - Test relay status display
    - Test connection controls (start/stop)
    - Test DHT operations (store/retrieve)
    - Test keyboard shortcuts
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 10.7, 12.3_

- [x] 13. Security Hardening
  - [x] 13.1 Implement message validation
    - Validate all incoming messages against protocol specs
    - Drop connection on invalid message
    - _Requirements: 9.1, 9.5_
  - [x] 13.2 Implement rate limiting
    - Rate-limit incoming connections
    - Rate-limit relay requests
    - _Requirements: 9.2, 3.5_
  - [x] 13.3 Write property test for message validation
    - **Property 9: Message Validation and Security**
    - Test invalid messages cause connection drop
    - **Validates: Requirements 9.1, 9.2, 9.5**

- [x] 14. Connection Upgrade
  - [x] 14.1 Implement periodic direct connection retry
    - For relayed connections, periodically attempt direct WebRTC
    - Upgrade to direct if successful
    - _Requirements: 3.4, 10.6_
  - [x] 14.2 Write property test for connection upgrade
    - **Property 15: Connection Upgrade Attempts**
    - Test periodic upgrade attempts occur
    - **Validates: Requirements 10.6**

- [x] 15. Integration Testing
  - [x] 15.1 Test browser node connecting to server bootstrap
    - Verify WebSocket connection established
    - Verify DHT bootstrap completes
    - _Requirements: 1.5, 2.1_
  - [x] 15.2 Test browser-to-browser WebRTC connection
    - Verify direct connection when possible
    - Verify circuit relay fallback
    - _Requirements: 2.2, 2.3, 2.4, 3.2_
  - [x] 15.3 Test tab visibility handling
    - Verify disconnect on tab hidden
    - Verify reconnect on tab visible
    - _Requirements: 8.4, 8.5_
  - [x] 15.4 Test relay capacity limits
    - Verify rejection when at capacity
    - Verify failover to alternative relay
    - _Requirements: 10.3, 10.4, 11.3_

- [x] 16. Documentation
  - [x] 16.1 Create docs/browser-node-guide.md
    - Document how to use browser nodes
    - Document configuration options
    - Document troubleshooting
    - _Requirements: 7.3_
  - [x] 16.2 Update README.md
    - Add section on browser node support
    - Document hybrid architecture
    - _Requirements: 6.5_

- [x] 17. Final Checkpoint
  - Ensure all property tests pass
  - Ensure browser nodes work in Chrome, Firefox, Safari, Edge
  - Ensure hybrid network functions correctly
  - Document any issues or observations
  - Ask the user if questions arise

## Notes

- All tasks are required for comprehensive coverage
- Browser testing requires actual browser environment (not just Node.js)
- WebRTC testing may require STUN server access
- Circuit relay testing requires server nodes running
- TypeScript DOM types need to be added to tsconfig.json for browser modules

## Key Files

```
src/browser/
├── index.ts                    # Main exports
├── browser-node.ts             # BrowserNode class
├── peer-id-manager.ts          # Peer ID generation/persistence ✅
├── activity-monitor.ts         # Tab visibility/network monitoring ✅
├── transport-config.ts         # libp2p transport configuration
├── relay-selector.ts           # Relay node selection
├── storage.ts                  # IndexedDB wrapper ✅
├── types.ts                    # TypeScript interfaces ✅
└── __tests__/
    ├── browser-node.test.ts
    ├── browser-node.property.test.ts
    ├── peer-id-manager.test.ts
    ├── peer-id-manager.property.test.ts
    ├── activity-monitor.test.ts
    └── activity-monitor.property.test.ts

public/
├── index.html                  # Existing thin client UI
└── full-node.html              # New full node UI

src/cli/
└── ws-bridge.ts                # Add /browser/config endpoint
```

## Dependencies to Add

```json
{
  "dependencies": {
    "@libp2p/webrtc": "^4.0.0",
    "@libp2p/circuit-relay-v2": "^1.0.0",
    "idb": "^8.0.0"
  }
}
```
