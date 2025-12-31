# Requirements Document

## Introduction

This document specifies requirements for an overlay messaging network built on top of the existing Kademlia DHT implementation. The overlay network enables request-response messaging between specific nodes, with message deduplication to prevent flooding, DHT-based routing for message delivery, and hybrid post-quantum end-to-end encryption for payload confidentiality.

## Glossary

- **Overlay_Network**: A messaging layer built on top of the DHT that enables targeted node-to-node communication
- **Message**: A request sent from an origin node to a target node expecting a response
- **Message_ID**: A unique identifier (UUID) for each message used for deduplication and response correlation
- **Origin_Node**: The node that initiates a message request
- **Target_Node**: The node that receives and processes a message request
- **Relay_Node**: An intermediate node that forwards messages toward the target
- **Deduplication_Cache**: A time-limited cache of seen message IDs to prevent duplicate processing
- **TTL**: Time-to-live, the maximum number of hops a message can traverse before expiring
- **Redundancy**: The number of parallel paths used to send a message for reliability
- **Path**: The ordered list of peer IDs a message has traversed
- **Handler**: A user-defined function that processes incoming messages and returns responses
- **Hybrid_KEM**: A key encapsulation mechanism combining classical (X25519) and post-quantum (ML-KEM-768) cryptography
- **E2E_Encryption**: End-to-end encryption where only origin and target can read message payloads
- **Ephemeral_Key**: A temporary key pair generated per-message for forward secrecy
- **Attestation**: A cryptographic proof that a node is running specific, verified code
- **Attestation_Verifier**: An optional component that validates node attestations before sending sensitive messages

## Requirements

### Requirement 1: Message Sending

**User Story:** As a node operator, I want to send a message to a specific target node and receive a response, so that I can communicate with any node in the network.

#### Acceptance Criteria

1. WHEN a node calls sendMessage with a target peer ID and payload, THE Overlay_Network SHALL route the message toward the target using DHT routing
2. WHEN the target node receives the message, THE Overlay_Network SHALL invoke the registered handler and return the response to the origin
3. WHEN sendMessage is called with a timeout option, THE Overlay_Network SHALL reject the promise if no response is received within the timeout period
4. WHEN sendMessage is called with a redundancy option, THE Overlay_Network SHALL send the message via multiple parallel paths simultaneously
5. IF the target node is unreachable, THEN THE Overlay_Network SHALL reject with an UNREACHABLE error
6. IF the message TTL expires before reaching the target, THEN THE Overlay_Network SHALL reject with a TTL_EXPIRED error

### Requirement 2: Message Handling

**User Story:** As a node operator, I want to register a handler for incoming messages, so that my node can process requests and return responses.

#### Acceptance Criteria

1. WHEN a node calls onMessage with a handler function, THE Overlay_Network SHALL register that handler for incoming messages
2. WHEN a message arrives at the target node, THE Overlay_Network SHALL invoke the handler with the origin peer ID and payload
3. WHEN the handler returns a response, THE Overlay_Network SHALL send that response back to the origin node
4. WHEN the handler throws an error, THE Overlay_Network SHALL send an error response back to the origin node
5. WHEN a node calls offMessage, THE Overlay_Network SHALL remove the registered handler
6. IF no handler is registered when a message arrives, THEN THE Overlay_Network SHALL respond with a NO_HANDLER error

### Requirement 3: Message Deduplication

**User Story:** As a network operator, I want messages to be deduplicated at each node, so that the network is not flooded with redundant traffic.

#### Acceptance Criteria

1. WHEN a node receives a message with a message ID it has already seen, THE Relay_Node SHALL NOT forward the message again
2. WHEN a duplicate message is received, THE Relay_Node SHALL respond with a DUPLICATE message to the immediate sender only
3. WHEN a message is forwarded, THE Relay_Node SHALL record the message ID and the peers it was forwarded to
4. WHEN the deduplication cache TTL expires for a message ID, THE Overlay_Network SHALL remove it from the cache
5. THE Deduplication_Cache TTL SHALL be based on the expected message propagation time across the network

### Requirement 4: Message Routing

**User Story:** As a node operator, I want messages to be routed efficiently through the DHT, so that they reach the target node reliably.

#### Acceptance Criteria

1. WHEN a relay node receives a message not destined for itself, THE Relay_Node SHALL forward it to the closest known peers to the target
2. WHEN forwarding a message, THE Relay_Node SHALL decrement the TTL by 1
3. WHEN forwarding a message, THE Relay_Node SHALL append its own peer ID to the message path
4. IF the TTL reaches 0 before reaching the target, THEN THE Relay_Node SHALL return an UNREACHABLE error
5. IF no closer peers are known, THEN THE Relay_Node SHALL return a NO_ROUTE error

### Requirement 5: Response Routing

**User Story:** As a node operator, I want responses to be routed back to the origin node, so that I receive the result of my request.

#### Acceptance Criteria

1. WHEN the target node generates a response, THE Overlay_Network SHALL route it back to the origin node
2. THE Overlay_Network SHALL support routing responses via the reverse of the request path
3. THE Overlay_Network SHALL support routing responses via a new DHT lookup to the origin
4. WHEN multiple responses arrive for the same message ID, THE Origin_Node SHALL accept only the first response
5. IF the response cannot reach the origin, THEN THE Overlay_Network SHALL fail silently (origin will timeout)

### Requirement 6: Wire Protocol

**User Story:** As a developer, I want a well-defined wire protocol, so that messages can be serialized and transmitted between nodes.

#### Acceptance Criteria

1. THE Overlay_Network SHALL define a REQUEST message type containing: messageId, originPeerId, targetPeerId, ttl, timestamp, path, and encryptedPayload
2. THE Overlay_Network SHALL define a RESPONSE message type containing: messageId, originPeerId, targetPeerId, path, encryptedPayload, and success flag
3. THE Overlay_Network SHALL define a DUPLICATE message type containing: messageId
4. THE Overlay_Network SHALL define an UNREACHABLE message type containing: messageId and reason (TTL_EXPIRED, TARGET_NOT_FOUND, NO_ROUTE, NO_HANDLER)
5. THE Overlay_Network SHALL enforce a maximum message size (default 64KB)
6. THE Overlay_Network SHALL serialize messages using a compact binary format
7. THE REQUEST message SHALL include the origin's hybrid public keys for response encryption

### Requirement 7: Configuration

**User Story:** As a node operator, I want to configure overlay network parameters, so that I can tune performance for my use case.

#### Acceptance Criteria

1. THE DHTNodeConfig SHALL include an overlay configuration section
2. THE overlay configuration SHALL include maxMessageSize with a default of 64KB
3. THE overlay configuration SHALL include defaultTTL based on estimated network size
4. THE overlay configuration SHALL include dedupeWindowMs for cache expiry time
5. THE overlay configuration SHALL include defaultRedundancy for parallel paths (default 3)
6. THE overlay configuration SHALL include responseTimeout for request timeout (default 30s)
7. WHEN overlay is not configured, THE Overlay_Network SHALL use sensible defaults
8. THE overlay configuration SHALL include encryption settings with hybrid post-quantum as default

### Requirement 8: Error Handling

**User Story:** As a node operator, I want clear error messages when messaging fails, so that I can diagnose and handle failures appropriately.

#### Acceptance Criteria

1. WHEN a message times out, THE Overlay_Network SHALL reject with a TIMEOUT error including the message ID
2. WHEN a target is unreachable, THE Overlay_Network SHALL reject with an UNREACHABLE error including the reason
3. WHEN a message exceeds the maximum size, THE Overlay_Network SHALL reject with a MESSAGE_TOO_LARGE error
4. WHEN the handler throws an error, THE Overlay_Network SHALL include the error message in the response
5. IF an invalid message is received, THEN THE Overlay_Network SHALL drop it silently and log a warning
6. IF decryption fails, THEN THE Overlay_Network SHALL reject with a DECRYPTION_FAILED error

### Requirement 9: End-to-End Encryption

**User Story:** As a node operator, I want message payloads to be encrypted end-to-end, so that relay nodes cannot read or tamper with message contents.

#### Acceptance Criteria

1. WHEN sending a message, THE Origin_Node SHALL encrypt the payload using hybrid post-quantum encryption (X25519 + ML-KEM-768)
2. THE Overlay_Network SHALL use ephemeral key pairs for each message to provide forward secrecy
3. WHEN encrypting a payload, THE Overlay_Network SHALL derive a shared secret using both X25519 ECDH and ML-KEM-768 encapsulation
4. THE Overlay_Network SHALL combine the classical and post-quantum shared secrets using HKDF before deriving the AES key
5. THE Overlay_Network SHALL encrypt payloads using AES-256-GCM with the derived key
6. THE REQUEST message SHALL include the ephemeral public keys (X25519 + ML-KEM) and the ML-KEM ciphertext
7. WHEN the target receives a message, THE Target_Node SHALL decrypt the payload using its private keys
8. WHEN sending a response, THE Target_Node SHALL encrypt the response payload using the origin's public keys from the request
9. THE Overlay_Network SHALL support looking up a target's public keys via DHT before sending
10. FOR ALL valid payloads, encrypting then decrypting SHALL produce the original payload (round-trip property)

### Requirement 10: Key Management

**User Story:** As a node operator, I want my encryption keys to be managed securely, so that my communications remain confidential.

#### Acceptance Criteria

1. WHEN a node starts, THE Overlay_Network SHALL generate or load a hybrid key pair (X25519 + ML-KEM-768)
2. THE Overlay_Network SHALL store the node's long-term private keys securely
3. THE Overlay_Network SHALL publish the node's public keys to the DHT for discovery
4. THE Overlay_Network SHALL cache discovered public keys locally with a configurable TTL
5. WHEN a cached public key expires, THE Overlay_Network SHALL refresh it from the DHT
6. THE Overlay_Network SHALL support key rotation by publishing new keys and maintaining old keys for a transition period

### Requirement 11: Code Attestation (Optional/Future)

**User Story:** As a security-conscious node operator, I want to verify that target nodes are running trusted code, so that I can ensure my messages are handled correctly.

#### Acceptance Criteria

1. WHERE attestation is enabled, THE Overlay_Network SHALL support registering an Attestation_Verifier
2. WHERE attestation is enabled, THE Overlay_Network SHALL include a handler code hash in node announcements
3. WHERE attestation is enabled, WHEN sending a message THE Origin_Node MAY request the target's attestation before sending
4. WHERE attestation is enabled, THE Attestation_Verifier SHALL validate that the target's code hash matches expected values
5. WHERE attestation is enabled, IF attestation verification fails THEN THE Overlay_Network SHALL reject with an ATTESTATION_FAILED error
6. THE Overlay_Network SHALL define an extensible attestation interface to support future TEE-based attestation
7. WHEN attestation is not configured, THE Overlay_Network SHALL operate without attestation checks
