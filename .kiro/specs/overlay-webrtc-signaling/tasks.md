# Implementation Plan: Overlay WebRTC Signaling

## Overview

This plan implements WebRTC signaling over the overlay network, enabling browser nodes to establish direct peer-to-peer connections without dedicated signaling servers. The implementation uses the existing overlay messaging infrastructure for encrypted SDP/ICE exchange.

## Tasks

- [ ] 1. Core Types and Protocol
  - [ ] 1.1 Create src/browser/signaling/types.ts
    - Define SignalingMessageType enum
    - Define all message interfaces (ConnectionRequest, ConnectionAccept, etc.)
    - Define SignalingSession interface and state types
    - Define SignalingConfig interface
    - Define SignalingError class and error codes
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [ ] 1.2 Create src/browser/signaling/signaling-protocol.ts
    - Implement encode() for all message types
    - Implement decode() for all message types
    - Implement validate() for message structure
    - Use compact binary format for efficiency
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_
  - [ ] 1.3 Write property test for message serialization round-trip
    - **Property 1: Signaling Message Serialization Round-Trip**
    - Generate random messages of all types
    - Verify encode/decode preserves all fields
    - **Validates: Requirements 1.2, 1.3, 1.5, 2.2, 4.1-4.6**

- [ ] 2. Session Management
  - [ ] 2.1 Create src/browser/signaling/session-store.ts
    - Implement SessionStore class
    - Support get/set/delete by session ID
    - Support getByPeer() for peer-based lookup
    - Implement cleanup() for expired sessions
    - _Requirements: 3.1, 3.4, 3.5_
  - [ ] 2.2 Create src/browser/signaling/signaling-session.ts
    - Implement SignalingSession class
    - Track session state transitions
    - Manage RTCPeerConnection lifecycle
    - Handle pending ICE candidates
    - _Requirements: 3.1, 5.1, 5.2, 5.4, 5.5_
  - [ ] 2.3 Write property test for session lifecycle
    - **Property 4: Session Lifecycle Management**
    - Test session creation, timeout, completion, failure
    - Verify cleanup on all terminal states
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 5.4, 5.5**

- [ ] 3. Checkpoint - Verify core infrastructure
  - Ensure TypeScript compiles without errors
  - Ensure unit tests pass
  - Ask the user if questions arise

- [ ] 4. Rate Limiting
  - [ ] 4.1 Create src/browser/signaling/rate-limiter.ts
    - Implement RateLimiter class
    - Support configurable max requests per window
    - Implement isAllowed(), record(), getRemaining()
    - Implement automatic window reset
    - _Requirements: 8.4_
  - [ ] 4.2 Write property test for rate limiting
    - **Property 7: Rate Limiting**
    - Test requests beyond limit are rejected
    - Test window reset behavior
    - **Validates: Requirements 8.4**

- [ ] 5. SignalingManager Core
  - [ ] 5.1 Create src/browser/signaling/signaling-manager.ts
    - Implement SignalingManager class
    - Integrate SessionStore and RateLimiter
    - Implement start()/stop() lifecycle
    - Implement initiateConnection() method
    - Register overlay message handler
    - _Requirements: 1.1, 1.4, 5.1, 5.2_
  - [ ] 5.2 Implement connection request handling
    - Handle incoming CONNECTION_REQUEST messages
    - Create RTCPeerConnection and generate SDP answer
    - Send CONNECTION_ACCEPT or CONNECTION_REJECT
    - _Requirements: 1.4, 1.5, 1.6, 5.2_
  - [ ] 5.3 Write property test for connection request/response flow
    - **Property 2: Connection Request/Response Flow**
    - Test initiator sends valid CONNECTION_REQUEST
    - Test target responds with ACCEPT or REJECT
    - **Validates: Requirements 1.1, 1.4, 1.5, 5.1, 5.2**

- [ ] 6. ICE Candidate Exchange
  - [ ] 6.1 Implement ICE candidate handling in SignalingManager
    - Send ICE_CANDIDATE messages as candidates are discovered
    - Handle incoming ICE_CANDIDATE messages
    - Add candidates to RTCPeerConnection
    - Handle pending candidates (received before remote description)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [ ] 6.2 Implement ICE completion handling
    - Send ICE_COMPLETE when gathering finishes
    - Handle incoming ICE_COMPLETE messages
    - Transition session state appropriately
    - _Requirements: 2.5_
  - [ ] 6.3 Write property test for ICE candidate exchange
    - **Property 3: ICE Candidate Exchange**
    - Test candidates are sent incrementally (trickle)
    - Test candidates are added to peer connection
    - Test ICE_COMPLETE is sent on gathering complete
    - **Validates: Requirements 2.1, 2.3, 2.4, 2.5**

- [ ] 7. Checkpoint - Verify signaling flow
  - Ensure connection request/response works
  - Ensure ICE exchange works
  - Ask the user if questions arise

- [ ] 8. Error Handling and Retry
  - [ ] 8.1 Implement session timeout handling
    - Set timeout timer on session creation
    - Clean up session on timeout
    - Notify initiator of timeout
    - _Requirements: 3.2, 3.3_
  - [ ] 8.2 Implement retry with exponential backoff
    - Retry failed overlay messages
    - Use exponential backoff between retries
    - Fail session after max retries
    - _Requirements: 7.1_
  - [ ] 8.3 Write property test for retry behavior
    - **Property 8: Retry with Exponential Backoff**
    - Test retries occur on message failure
    - Test backoff timing doubles
    - Test failure after max retries
    - **Validates: Requirements 7.1**

- [ ] 9. Validation and Security
  - [ ] 9.1 Implement message validation
    - Validate session ID exists and is active
    - Validate message comes from expected peer
    - Reject invalid message structures
    - _Requirements: 8.2, 8.3_
  - [ ] 9.2 Write property test for message validation
    - **Property 6: Message Validation**
    - Test invalid session IDs are rejected
    - Test messages from wrong peers are rejected
    - **Validates: Requirements 8.2, 8.3**

- [ ] 10. Concurrent Session Limits
  - [ ] 10.1 Implement concurrent session limiting
    - Track active sessions per peer
    - Reject new sessions when at limit
    - Support multiple connections to different peers
    - _Requirements: 3.6, 5.6_
  - [ ] 10.2 Write property test for concurrent limits
    - **Property 5: Concurrent Session Limits**
    - Test sessions beyond limit are rejected
    - Test multiple connections to different peers work
    - **Validates: Requirements 3.6, 5.6**

- [ ] 11. Checkpoint - Verify error handling and limits
  - Ensure timeout handling works
  - Ensure rate limiting works
  - Ensure concurrent limits work
  - Ask the user if questions arise

- [ ] 12. Metrics and Events
  - [ ] 12.1 Implement metrics tracking
    - Track sessionsInitiated, sessionsCompleted, sessionsFailed, sessionsTimedOut
    - Calculate averageSessionDurationMs
    - Implement getMetrics() method
    - _Requirements: 10.1, 10.2, 10.3_
  - [ ] 12.2 Implement event emission
    - Emit session:started, session:completed, session:failed events
    - Emit connection:established event
    - Implement on()/off() for event subscription
    - _Requirements: 10.4, 10.5_
  - [ ] 12.3 Write property test for metrics tracking
    - **Property 10: Metrics Tracking**
    - Test metrics increment correctly
    - Test average duration calculation
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4**

- [ ] 13. Configuration
  - [ ] 13.1 Implement configuration with defaults
    - Apply default values for all config options
    - Validate configuration values
    - Support runtime configuration updates
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
  - [ ] 13.2 Write property test for configuration defaults
    - **Property 9: Configuration Defaults**
    - Test defaults are applied when not specified
    - Test all default values match spec
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**

- [ ] 14. BrowserNode Integration
  - [ ] 14.1 Update BrowserNode to use SignalingManager
    - Add enableOverlaySignaling config option
    - Initialize SignalingManager after overlay is ready
    - Register signaling message handler
    - _Requirements: 6.1, 6.2, 6.3_
  - [ ] 14.2 Implement connectToPeer() method
    - Expose method to initiate WebRTC connection
    - Handle connection establishment
    - Register connection with libp2p
    - _Requirements: 6.1, 6.4, 6.5_
  - [ ] 14.3 Implement fallback to circuit relay
    - Fall back when overlay signaling fails
    - Fall back when direct WebRTC fails
    - Maintain circuit relay as reliable fallback
    - _Requirements: 6.4, 9.6_

- [ ] 15. Checkpoint - Verify integration
  - Ensure BrowserNode can use overlay signaling
  - Ensure fallback to circuit relay works
  - Ask the user if questions arise

- [ ] 16. Integration Testing
  - [ ] 16.1 Test end-to-end connection establishment
    - Two browser nodes establish WebRTC via overlay signaling
    - Verify connection is usable for libp2p protocols
    - _Requirements: 1.1, 5.3, 6.1, 6.2_
  - [ ] 16.2 Test connection rejection scenarios
    - Test rejection when at max connections
    - Test rejection when WebRTC unavailable
    - _Requirements: 1.6, 7.2, 7.3, 7.4_
  - [ ] 16.3 Test timeout and retry scenarios
    - Test session timeout when peer unreachable
    - Test retry behavior on transient failures
    - _Requirements: 3.3, 7.1, 7.5_

- [ ] 17. Documentation
  - [ ] 17.1 Update docs/browser-node-guide.md
    - Document overlay signaling feature
    - Document configuration options
    - Document troubleshooting
    - _Requirements: 9.1-9.6_
  - [ ] 17.2 Create src/browser/signaling/index.ts
    - Export all public types and classes
    - Add module documentation
    - _Requirements: 4.7_

- [ ] 18. Final Checkpoint
  - Ensure all property tests pass
  - Ensure integration tests pass
  - Ensure overlay signaling works end-to-end
  - Document any issues or observations
  - Ask the user if questions arise

## Notes

- All tasks are required for comprehensive coverage
- Overlay signaling requires the overlay network to be initialized first
- RTCPeerConnection requires browser environment (not Node.js)
- Circuit relay remains as fallback when direct WebRTC fails
- All signaling messages are encrypted via overlay's hybrid encryption

## Key Files

```
src/browser/signaling/
├── index.ts                        # Main exports
├── signaling-manager.ts            # SignalingManager class
├── signaling-session.ts            # SignalingSession class
├── signaling-protocol.ts           # Message encoding/decoding
├── session-store.ts                # Session storage
├── rate-limiter.ts                 # Rate limiting
├── types.ts                        # TypeScript interfaces
└── __tests__/
    ├── signaling-manager.test.ts
    ├── signaling-manager.property.test.ts
    ├── signaling-protocol.test.ts
    ├── signaling-protocol.property.test.ts
    ├── session-store.test.ts
    ├── rate-limiter.test.ts
    └── rate-limiter.property.test.ts

src/browser/
├── browser-node.ts                 # Update to integrate SignalingManager
└── types.ts                        # Add signaling config types

src/integration/
└── overlay-signaling.integration.test.ts
```

## Dependencies

No new dependencies required - uses existing:
- Overlay network for message transport
- RTCPeerConnection (browser built-in)
- fast-check for property tests
