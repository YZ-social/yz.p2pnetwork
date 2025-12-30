# Implementation Plan: Kademlia DHT with libp2p

## Overview

This plan implements a Kademlia DHT using js-libp2p with TypeScript. Tasks are ordered to build foundational components first, then layer on DHT functionality, and finally add integration tests. Property-based tests validate correctness properties from the design.

## Tasks

- [x] 1. Project setup and dependencies
  - Initialize TypeScript project with ESM modules
  - Install dependencies: `libp2p`, `@libp2p/kad-dht`, `@libp2p/tcp`, `@libp2p/websockets`, `@libp2p/webrtc`, `@libp2p/circuit-relay-v2`, `@chainsafe/libp2p-noise`, `@chainsafe/libp2p-yamux`, `@libp2p/bootstrap`, `@libp2p/identify`
  - Install dev dependencies: `vitest`, `fast-check`, `typescript`, `@types/node`
  - Configure `tsconfig.json` and `vitest.config.ts`
  - Create source directory structure: `src/dht/`, `src/test-utils/`, `src/integration/`
  - _Requirements: 8.6_

- [x] 2. Implement XOR distance utilities
  - [x] 2.1 Create `src/dht/distance.ts` with XOR distance functions
    - Implement `xorDistance(a: Uint8Array, b: Uint8Array): Uint8Array`
    - Implement `compareDistance(a: Uint8Array, b: Uint8Array): number`
    - Implement `getBucketIndex(localId: Uint8Array, peerId: Uint8Array): number`
    - _Requirements: 3.4_
  - [x] 2.2 Write property tests for XOR distance symmetry

    - **Property 1: XOR Distance Symmetry**
    - **Validates: Requirements 3.4**
  - [x] 2.3 Write property tests for bucket index consistency

    - **Property 2: Bucket Index Consistency**
    - **Validates: Requirements 3.4**

- [x] 3. Implement configuration module
  - [x] 3.1 Create `src/dht/config.ts` with configuration types and builder
    - Define `DHTNodeConfig` interface
    - Implement `DHTConfigBuilder` class with fluent API
    - Implement `serializeConfig` and `deserializeConfig` functions
    - Add validation for required fields and value ranges
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [x] 3.2 Write property tests for configuration round-trip

    - **Property 3: Configuration Round-Trip**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
  - [x] 3.3 Write unit tests for configuration validation

    - Test invalid configurations return errors
    - Test default values are applied correctly
    - _Requirements: 1.4_

- [x] 4. Implement error types
  - Create `src/dht/errors.ts` with `DHTErrorCode` enum and `DHTError` class
  - Define error codes for all error categories (init, network, DHT ops, provider)
  - _Requirements: 1.4, 2.3, 4.3_

- [x] 5. Checkpoint - Verify foundation
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement libp2p node factory
  - [x] 6.1 Create `src/dht/factory.ts` with node creation logic
    - Implement `createLibp2pNode(config: DHTNodeConfig): Promise<Libp2p>`
    - Configure transports (TCP, WebSocket, WebRTC)
    - Configure connection encryption (noise)
    - Configure stream muxer (yamux)
    - Configure Kademlia DHT service
    - Configure circuit relay for NAT traversal
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1, 2.2, 2.4_
  - [x] 6.2 Write unit tests for node factory

    - Test node creation with valid config
    - Test node creation with invalid config throws
    - Test WebRTC configuration
    - _Requirements: 1.1, 1.4, 2.1_

- [x] 7. Implement DHTNode facade
  - [x] 7.1 Create `src/dht/node.ts` with main DHTNode class
    - Implement lifecycle methods: `start()`, `stop()`
    - Expose identity: `peerId`, `multiaddrs`
    - Implement event handling for peer connect/disconnect
    - _Requirements: 1.1, 1.2, 1.3, 6.1, 6.5_
  - [x] 7.2 Implement bootstrap functionality
    - Implement `bootstrap(peers?: string[]): Promise<void>`
    - Handle bootstrap failures with appropriate errors
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 7.3 Implement peer discovery operations
    - Implement `findPeer(peerId: PeerId): Promise<PeerInfo>`
    - Implement `getClosestPeers(key: Uint8Array): AsyncIterable<PeerInfo>`
    - _Requirements: 3.1, 3.5_
  - [x] 7.4 Write property tests for closest peers ordering

    - **Property 4: Closest Peers Ordering**
    - **Validates: Requirements 3.1, 3.5**

- [x] 8. Implement routing table diagnostics
  - [x] 8.1 Create `src/dht/routing.ts` with routing table info
    - Implement `getRoutingTableInfo(): RoutingTableInfo`
    - Extract bucket information from DHT internals
    - _Requirements: 3.4_
  - [x] 8.2 Write property tests for k-bucket size invariant

    - **Property 5: K-Bucket Size Invariant**
    - **Validates: Requirements 3.4, 8.1**

- [x] 9. Checkpoint - Verify node and routing
  - Ensure all tests pass, ask the user if questions arise.

- [-] 10. Implement content operations
  - [x] 10.1 Add PUT/GET operations to DHTNode
    - Implement `put(key: Uint8Array, value: Uint8Array): Promise<void>`
    - Implement `get(key: Uint8Array): Promise<Uint8Array>`
    - Add validation for key-value pairs
    - Handle not-found errors appropriately
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 10.2 Write property tests for put-get consistency

    - **Property 6: Put-Get Consistency**
    - **Validates: Requirements 4.1, 4.2**
  - [x] 10.3 Write unit tests for content operations

    - Test PUT with valid key-value
    - Test GET returns stored value
    - Test GET on missing key returns not-found error
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 11. Implement provider operations
  - [x] 11.1 Add provider operations to DHTNode
    - Implement `provide(key: CID): Promise<void>`
    - Implement `findProviders(key: CID): AsyncIterable<PeerInfo>`
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 11.2 Write property tests for provider record round-trip

    - **Property 7: Provider Record Round-Trip**
    - **Validates: Requirements 5.1, 5.2**
  - [x] 11.3 Write unit tests for provider operations

    - Test provide publishes record
    - Test findProviders returns provider
    - _Requirements: 5.1, 5.2_

- [x] 12. Implement connection management
  - [x] 12.1 Add connection management to DHTNode
    - Configure max/min connections from config
    - Implement connection limit enforcement
    - _Requirements: 6.2, 6.3, 6.4_
  - [x] 12.2 Write unit tests for connection management

    - Test connection limits are enforced
    - Test events are emitted on state changes
    - _Requirements: 6.3, 6.4, 6.5_

- [x] 13. Checkpoint - Verify all operations
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Create test utilities
  - [x] 14.1 Create `src/test-utils/generators.ts` with fast-check generators
    - Implement `peerIdArbitrary` for generating peer IDs
    - Implement `uint8ArrayArbitrary` for generating byte arrays
    - Implement `configArbitrary` for generating valid configs
    - _Requirements: 7.1, 7.2_
  - [x] 14.2 Create `src/test-utils/network.ts` with test network helpers
    - Implement `createTestNetwork(numNodes: number)` for spinning up test nodes
    - Implement cleanup utilities
    - _Requirements: 7.6_

- [x] 15. Write integration tests
  - [x] 15.1 Create `src/integration/bootstrap.integration.test.ts`
    - Test node bootstrap with single bootstrap peer
    - Test node bootstrap with multiple bootstrap peers
    - Test bootstrap failure handling
    - _Requirements: 2.1, 2.2, 2.3, 7.3_
  - [x] 15.2 Create `src/integration/dht-operations.integration.test.ts`
    - Test PUT/GET across multiple nodes
    - Test provider publish and discovery across nodes
    - Test peer discovery across network
    - _Requirements: 4.1, 4.2, 5.1, 5.2, 7.4, 7.5_

- [x] 16. Export public API
  - Create `src/index.ts` exporting public types and classes
  - Export: `DHTNode`, `DHTNodeConfig`, `DHTConfigBuilder`, `DHTError`, `DHTErrorCode`
  - Export types: `PeerInfo`, `RoutingTableInfo`, `BucketInfo`
  - _Requirements: 1.1, 8.1_

- [x] 17. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Integration tests require multiple nodes and may take longer to run
