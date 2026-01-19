# Requirements Document

## Introduction

This feature enables WebRTC signaling (connection establishment) to occur over the existing overlay messaging network, eliminating the need for dedicated relay/signaling servers. When two browser nodes want to establish a direct WebRTC connection, they exchange SDP offers/answers and ICE candidates through encrypted overlay messages routed via the DHT network.

This approach leverages the existing overlay infrastructure to provide:
- End-to-end encrypted signaling (relay nodes cannot read SDP/ICE data)
- No dedicated signaling server required
- Works for any two peers that can reach each other via the overlay
- Graceful fallback when direct WebRTC fails (continue using overlay for messaging)

## Glossary

- **Signaling**: The process of exchanging connection metadata (SDP, ICE candidates) to establish a WebRTC connection
- **SDP_Offer**: Session Description Protocol offer containing media capabilities and connection parameters
- **SDP_Answer**: Session Description Protocol answer accepting/modifying the offer
- **ICE_Candidate**: Interactive Connectivity Establishment candidate representing a potential network path
- **Overlay_Signaling**: Using the overlay messaging network to exchange WebRTC signaling data
- **Connection_Request**: An overlay message requesting to establish a direct WebRTC connection
- **Signaling_Session**: A temporary state tracking an in-progress WebRTC connection establishment
- **Trickle_ICE**: Sending ICE candidates incrementally as they are discovered rather than all at once

## Requirements

### Requirement 1: Connection Request Initiation

**User Story:** As a browser node, I want to request a direct WebRTC connection to another browser node via the overlay network, so that I can establish peer-to-peer connectivity without a dedicated signaling server.

#### Acceptance Criteria

1. WHEN a Browser_Node wants to connect to another Browser_Node, THE initiator SHALL send a CONNECTION_REQUEST message via the overlay network
2. THE CONNECTION_REQUEST message SHALL include the initiator's peer ID and a unique session ID
3. THE CONNECTION_REQUEST message SHALL include the initiator's SDP offer
4. WHEN the target receives a CONNECTION_REQUEST, THE target SHALL respond with a CONNECTION_ACCEPT or CONNECTION_REJECT message
5. THE CONNECTION_ACCEPT message SHALL include the target's SDP answer
6. IF the target is unable to accept WebRTC connections, THEN THE target SHALL respond with CONNECTION_REJECT and a reason

### Requirement 2: ICE Candidate Exchange

**User Story:** As a browser node establishing a WebRTC connection, I want to exchange ICE candidates with my peer via the overlay network, so that we can find the best network path for our direct connection.

#### Acceptance Criteria

1. WHEN a Browser_Node discovers an ICE candidate during connection establishment, THE Browser_Node SHALL send an ICE_CANDIDATE message via the overlay network
2. THE ICE_CANDIDATE message SHALL include the session ID and the candidate data
3. WHEN a Browser_Node receives an ICE_CANDIDATE message, THE Browser_Node SHALL add the candidate to the corresponding RTCPeerConnection
4. THE Overlay_Signaling SHALL support trickle ICE (sending candidates as they are discovered)
5. WHEN ICE gathering is complete, THE Browser_Node SHALL send an ICE_COMPLETE message to signal no more candidates

### Requirement 3: Signaling Session Management

**User Story:** As a browser node, I want signaling sessions to be properly managed, so that resources are cleaned up and stale sessions don't accumulate.

#### Acceptance Criteria

1. THE Signaling_Manager SHALL track active signaling sessions by session ID
2. WHEN a signaling session is created, THE Signaling_Manager SHALL set a timeout for session completion
3. IF a signaling session times out, THEN THE Signaling_Manager SHALL clean up the session and notify the initiator
4. WHEN a WebRTC connection is successfully established, THE Signaling_Manager SHALL remove the signaling session
5. WHEN a WebRTC connection fails, THE Signaling_Manager SHALL clean up the session and allow retry
6. THE Signaling_Manager SHALL limit the number of concurrent signaling sessions per peer

### Requirement 4: Signaling Message Protocol

**User Story:** As a developer, I want a well-defined signaling message protocol, so that signaling messages can be reliably exchanged between nodes.

#### Acceptance Criteria

1. THE Overlay_Signaling SHALL define a CONNECTION_REQUEST message type containing: sessionId, initiatorPeerId, sdpOffer
2. THE Overlay_Signaling SHALL define a CONNECTION_ACCEPT message type containing: sessionId, sdpAnswer
3. THE Overlay_Signaling SHALL define a CONNECTION_REJECT message type containing: sessionId, reason
4. THE Overlay_Signaling SHALL define an ICE_CANDIDATE message type containing: sessionId, candidate, sdpMid, sdpMLineIndex
5. THE Overlay_Signaling SHALL define an ICE_COMPLETE message type containing: sessionId
6. THE Overlay_Signaling SHALL define a SESSION_ERROR message type containing: sessionId, errorCode, errorMessage
7. ALL signaling messages SHALL be encrypted end-to-end via the overlay network

### Requirement 5: WebRTC Connection Lifecycle

**User Story:** As a browser node, I want the WebRTC connection lifecycle to be properly managed, so that connections are established reliably and failures are handled gracefully.

#### Acceptance Criteria

1. WHEN initiating a connection, THE Browser_Node SHALL create an RTCPeerConnection and generate an SDP offer
2. WHEN receiving a CONNECTION_REQUEST, THE target SHALL create an RTCPeerConnection and generate an SDP answer
3. WHEN both peers have exchanged SDP and ICE candidates, THE RTCPeerConnection SHALL attempt to connect
4. WHEN the RTCPeerConnection reaches the "connected" state, THE Signaling_Session SHALL be marked complete
5. IF the RTCPeerConnection fails, THEN THE Browser_Node SHALL notify the peer via SESSION_ERROR
6. THE Browser_Node SHALL support multiple concurrent WebRTC connections to different peers

### Requirement 6: Integration with Existing Transport

**User Story:** As a browser node operator, I want overlay signaling to integrate seamlessly with the existing transport layer, so that WebRTC connections established via overlay signaling work like any other connection.

#### Acceptance Criteria

1. WHEN a WebRTC connection is established via overlay signaling, THE connection SHALL be registered with libp2p's connection manager
2. THE Browser_Node SHALL be able to use the WebRTC connection for all libp2p protocols (DHT, overlay, etc.)
3. WHEN the WebRTC connection is closed, THE Browser_Node SHALL clean up associated resources
4. THE Overlay_Signaling SHALL work alongside existing circuit relay transport (not replace it)
5. THE Browser_Node SHALL prefer direct WebRTC connections over relayed connections when available

### Requirement 7: Error Handling and Retry

**User Story:** As a browser node, I want signaling errors to be handled gracefully with appropriate retry logic, so that transient failures don't prevent connection establishment.

#### Acceptance Criteria

1. IF an overlay message fails to deliver, THEN THE Signaling_Manager SHALL retry with exponential backoff
2. IF the target peer is unreachable via overlay, THEN THE Signaling_Manager SHALL fail the session with PEER_UNREACHABLE
3. IF SDP negotiation fails, THEN THE Signaling_Manager SHALL fail the session with SDP_NEGOTIATION_FAILED
4. IF ICE connection fails, THEN THE Signaling_Manager SHALL fail the session with ICE_FAILED
5. THE Signaling_Manager SHALL expose error events for application-level handling
6. WHEN a session fails, THE initiator MAY retry after a configurable delay

### Requirement 8: Security

**User Story:** As a browser node operator, I want signaling to be secure, so that attackers cannot intercept or manipulate connection establishment.

#### Acceptance Criteria

1. ALL signaling messages SHALL be encrypted end-to-end using the overlay network's hybrid encryption
2. THE Signaling_Manager SHALL validate that signaling messages come from the expected peer
3. THE Signaling_Manager SHALL reject signaling messages with invalid or expired session IDs
4. THE Signaling_Manager SHALL rate-limit incoming connection requests to prevent DoS attacks
5. THE SDP offer/answer SHALL NOT be readable by relay nodes in the overlay path

### Requirement 9: Configuration

**User Story:** As a node operator, I want to configure overlay signaling parameters, so that I can tune behavior for my use case.

#### Acceptance Criteria

1. THE SignalingConfig SHALL include sessionTimeout with a default of 30 seconds
2. THE SignalingConfig SHALL include maxConcurrentSessions with a default of 10
3. THE SignalingConfig SHALL include retryAttempts with a default of 3
4. THE SignalingConfig SHALL include retryDelayMs with a default of 1000ms
5. THE SignalingConfig SHALL include enabled flag to enable/disable overlay signaling
6. WHEN overlay signaling is disabled, THE Browser_Node SHALL fall back to circuit relay only

### Requirement 10: Metrics and Observability

**User Story:** As a network operator, I want visibility into overlay signaling activity, so that I can monitor connection establishment and diagnose issues.

#### Acceptance Criteria

1. THE Signaling_Manager SHALL track: sessions_initiated, sessions_completed, sessions_failed, sessions_timed_out
2. THE Signaling_Manager SHALL track average session duration
3. THE Signaling_Manager SHALL expose metrics via a getMetrics() method
4. WHEN a session fails, THE Signaling_Manager SHALL log the failure reason
5. THE Signaling_Manager SHALL emit events for session lifecycle (started, completed, failed)

