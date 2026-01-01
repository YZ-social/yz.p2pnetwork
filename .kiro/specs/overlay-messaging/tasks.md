# Implementation Plan: Overlay Messaging Network

## Overview

This implementation plan breaks down the overlay messaging network into discrete coding tasks. The implementation follows a bottom-up approach: starting with crypto primitives, then building up through wire protocol, caching, and finally the main overlay facade.

## Tasks

- [x] 1. Set up overlay module structure and dependencies
  - Create `src/overlay/` directory structure
  - Add crypto dependencies: `@noble/curves`, `@noble/post-quantum`, `@noble/hashes`
  - Create error types and constants
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [x] 2. Implement hybrid post-quantum encryption
  - [x] 2.1 Create HybridCrypto class with key generation
    - Implement `generateKeyPair()` for X25519 + ML-KEM-768
    - Implement key serialization/deserialization
    - _Requirements: 10.1, 10.2_

  - [x] 2.2 Implement encryption function
    - Generate ephemeral X25519 key pair
    - Perform X25519 ECDH with recipient's public key
    - Perform ML-KEM-768 encapsulation
    - Combine secrets using HKDF
    - Encrypt payload with AES-256-GCM
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 2.3 Implement decryption function
    - Perform X25519 ECDH with ephemeral public key
    - Perform ML-KEM-768 decapsulation
    - Combine secrets using HKDF
    - Decrypt payload with AES-256-GCM
    - _Requirements: 9.7_

  - [x] 2.4 Write property test for encryption round-trip
    - **Property 1: Encryption Round-Trip**
    - **Validates: Requirements 9.1, 9.3, 9.4, 9.5, 9.7, 9.10**

  - [x] 2.5 Write property test for ephemeral key uniqueness
    - **Property 4: Ephemeral Keys Are Unique Per Message**
    - **Validates: Requirements 9.2**

- [x] 3. Implement key manager
  - [x] 3.1 Create KeyManager class
    - Implement key pair initialization (generate or load)
    - Implement secure key storage interface
    - _Requirements: 10.1, 10.2_

  - [x] 3.2 Implement DHT key publication
    - Create public key record format
    - Implement `publishPublicKey()` to store in DHT
    - _Requirements: 10.3_

  - [x] 3.3 Implement public key lookup and caching
    - Implement `lookupPublicKey()` from DHT
    - Create PublicKeyCache with TTL-based expiration
    - _Requirements: 10.4, 10.5_

  - [x] 3.4 Write property test for public key DHT round-trip
    - **Property 3: Public Key DHT Round-Trip**
    - **Validates: Requirements 10.3, 10.4**

- [x] 4. Checkpoint - Ensure crypto tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement wire protocol
  - [x] 5.1 Define message type enums and interfaces
    - Create MessageType enum
    - Create UnreachableReason enum
    - Define RequestMessage, ResponseMessage, DuplicateMessage, UnreachableMessage interfaces
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 5.2 Implement message encoding
    - Implement `encodeRequest()` with encrypted payload
    - Implement `encodeResponse()` with encrypted payload
    - Implement `encodeDuplicate()`
    - Implement `encodeUnreachable()`
    - _Requirements: 6.6_

  - [x] 5.3 Implement message decoding
    - Implement `decode()` to parse binary messages
    - Implement size validation
    - _Requirements: 6.5, 6.6_

  - [x] 5.4 Write property test for message serialization round-trip
    - **Property 2: Message Serialization Round-Trip**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.6, 6.7**

- [x] 6. Implement deduplication cache
  - [x] 6.1 Create DeduplicationCache class
    - Implement `isDuplicate()` check
    - Implement `record()` to store message ID and forwarded peers
    - Implement `getForwardedPeers()`
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 6.2 Implement cache expiration
    - Add TTL-based expiration
    - Implement `cleanup()` for expired entries
    - _Requirements: 3.4, 3.5_

  - [x] 6.3 Write property test for deduplication
    - **Property 5: Deduplication Prevents Re-Forwarding**
    - **Validates: Requirements 3.1, 3.2**

  - [x] 6.4 Write property test for cache expiration
    - **Property 15: Deduplication Cache Expiration**
    - **Validates: Requirements 3.4**

- [x] 7. Implement pending requests manager
  - [x] 7.1 Create PendingRequestsManager class
    - Implement `register()` to track pending requests
    - Implement `resolve()` to complete requests
    - Implement `reject()` to fail requests
    - _Requirements: 1.3, 5.4_

  - [x] 7.2 Implement timeout handling
    - Add per-request timeout timers
    - Implement `checkTimeouts()` for cleanup
    - _Requirements: 1.3, 8.1_

  - [x] 7.3 Write property test for first response wins
    - **Property 8: First Response Wins**
    - **Validates: Requirements 5.4**

  - [x] 7.4 Write property test for timeout behavior
    - **Property 10: Timeout Behavior**
    - **Validates: Requirements 1.3, 8.1**

- [x] 8. Checkpoint - Ensure component tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement message router
  - [x] 9.1 Create MessageRouter class
    - Integrate with DHTNode for peer lookup
    - Implement `getNextHops()` using DHT routing
    - _Requirements: 4.1_

  - [x] 9.2 Implement message forwarding logic
    - Implement TTL decrement
    - Implement path tracking (append peer ID)
    - Handle TTL=0 case with UNREACHABLE error
    - _Requirements: 4.2, 4.3, 4.4_

  - [x] 9.3 Implement response routing
    - Support reverse path routing
    - Support DHT-based routing to origin
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 9.4 Write property test for TTL decrement
    - **Property 6: TTL Decrement on Forward**
    - **Validates: Requirements 4.2**

  - [x] 9.5 Write property test for path tracking
    - **Property 7: Path Tracking on Forward**
    - **Validates: Requirements 4.3**

- [x] 10. Implement overlay network facade
  - [x] 10.1 Create OverlayNetwork class
    - Implement constructor with config validation
    - Implement `start()` and `stop()` lifecycle methods
    - Register libp2p protocol handler
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

  - [x] 10.2 Implement sendMessage
    - Lookup target's public key
    - Encrypt payload with hybrid encryption
    - Create REQUEST message
    - Route via DHT
    - Register pending request
    - _Requirements: 1.1, 1.4, 9.1, 9.6_

  - [x] 10.3 Implement message handling
    - Implement `onMessage()` handler registration
    - Implement `offMessage()` handler removal
    - Decrypt incoming payloads
    - Invoke handler with plaintext
    - Encrypt and send response
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 9.7, 9.8_

  - [x] 10.4 Implement incoming message processing
    - Check deduplication cache
    - Handle duplicate messages
    - Forward or process based on target
    - _Requirements: 3.1, 3.2, 3.3, 4.1_

  - [x] 10.5 Write property test for message size validation
    - **Property 9: Message Size Validation**
    - **Validates: Requirements 6.5, 8.3**

  - [x] 10.6 Write property test for handler invocation
    - **Property 11: Handler Invocation Context**
    - **Validates: Requirements 2.2**

  - [x] 10.7 Write property test for handler error propagation
    - **Property 12: Handler Error Propagation**
    - **Validates: Requirements 2.4, 8.4**

  - [x] 10.8 Write property test for no handler error
    - **Property 13: No Handler Error Response**
    - **Validates: Requirements 2.6**

  - [x] 10.9 Write property test for configuration defaults
    - **Property 14: Configuration Defaults Applied**
    - **Validates: Requirements 7.7**

- [x] 11. Checkpoint - Ensure overlay tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement attestation hooks (optional)
  - [x] 12.1 Create AttestationVerifier interface
    - Define NodeAttestation type
    - Define AttestationResult type
    - Create NoOpAttestationVerifier default implementation
    - _Requirements: 11.1, 11.6, 11.7_

  - [x] 12.2 Integrate attestation into overlay
    - Add attestation config option
    - Implement `setAttestationVerifier()`
    - Add attestation request flag to messages
    - Include attestation in responses when requested
    - _Requirements: 11.2, 11.3, 11.4, 11.5_

  - [x] 12.3 Write unit tests for attestation interface
    - Test NoOpAttestationVerifier
    - Test attestation config handling
    - _Requirements: 11.1, 11.7_

- [x] 13. Write integration tests
  - [x] 13.1 Create test network helpers
    - Helper to create multi-node test networks
    - Helper to wait for message delivery
    - _Requirements: 1.1, 1.2_

  - [x] 13.2 Write end-to-end messaging tests
    - Test direct message between two nodes
    - Test multi-hop routing through relay
    - Test encrypted payload confidentiality
    - _Requirements: 1.1, 1.2, 9.1, 9.7_

  - [x] 13.3 Write redundancy and reliability tests
    - Test redundant path delivery
    - Test response routing via reverse path
    - Test response routing via DHT lookup
    - _Requirements: 1.4, 5.2, 5.3_

- [x] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks including property tests are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- The attestation feature (task 12) is designed as optional hooks for future implementation
