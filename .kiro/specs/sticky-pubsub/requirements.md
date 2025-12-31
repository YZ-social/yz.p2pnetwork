# Requirements Document

## Introduction

This document specifies requirements for Sticky Pub/Sub, a DHT-based publish-subscribe system with message persistence. Unlike traditional pub/sub where subscribers only receive messages published after they join, Sticky Pub/Sub delivers historical messages to new subscribers (hence "sticky"). The system is fully decentralized, using the DHT for storage and the overlay messaging layer for encrypted message delivery.

**Prerequisites:** This feature requires the overlay-messaging layer to be implemented first.

## Glossary

- **Sticky_PubSub**: A pub/sub system where new subscribers receive historical messages
- **Topic**: A named channel identified by a topic ID that publishers and subscribers connect to
- **Topic_ID**: A unique string identifier for a topic (e.g., "chat-room-42")
- **Coordinator**: A mutable object stored at k-closest nodes to the topic hash, tracking topic state
- **Coordinator_Snapshot**: An immutable historical snapshot of coordinator state for deep merge history
- **Subscriber_Collection**: An immutable list of active subscribers with expiry times
- **Message_Collection**: An immutable list of message references with metadata
- **Publisher**: A node that sends messages to a topic
- **Subscriber**: A node that receives messages from a topic
- **Initiator_Node**: The k-closest node that handles a specific pub/sub operation
- **Version**: A monotonic counter tracking coordinator updates
- **Delta_Delivery**: Sending only messages added since a subscriber's last seen version
- **Optimistic_Concurrency**: Update strategy that detects and merges concurrent modifications
- **Collection_ID**: A content-addressed identifier (hash) for immutable collections

## Requirements

### Requirement 1: Topic Subscription

**User Story:** As a subscriber, I want to subscribe to a topic and receive both historical and new messages, so that I have full context of the conversation.

#### Acceptance Criteria

1. WHEN a node calls subscribe with a topic ID, THE Sticky_PubSub SHALL add the node to the topic's subscriber collection
2. WHEN a new subscriber joins, THE Sticky_PubSub SHALL deliver all non-expired historical messages to the subscriber
3. WHEN a subscriber provides a lastSeenVersion, THE Sticky_PubSub SHALL deliver only messages added after that version (delta delivery)
4. WHEN subscribing to a non-existent topic, THE Sticky_PubSub SHALL create a new coordinator for that topic
5. THE Sticky_PubSub SHALL set a default subscription TTL of 30 minutes
6. WHEN a subscription expires, THE Sticky_PubSub SHALL remove the subscriber from the collection during the next operation
7. THE Sticky_PubSub SHALL use the overlay messaging layer's encrypted sendMessage for delivering historical messages

### Requirement 2: Message Publishing

**User Story:** As a publisher, I want to publish messages to a topic with configurable TTL, so that all current and future subscribers receive them within the retention period.

#### Acceptance Criteria

1. WHEN a node calls publish with a topic ID and message data, THE Sticky_PubSub SHALL store the message in the DHT
2. WHEN publishing a message, THE Sticky_PubSub SHALL add the message reference to the topic's message collection
3. WHEN publishing a message, THE Sticky_PubSub SHALL increment the coordinator version
4. THE Sticky_PubSub SHALL assign each message a unique message ID and per-publisher sequence number
5. WHEN publish is called with a TTL option, THE Sticky_PubSub SHALL use that TTL for the message
6. WHEN publish is called without a TTL option, THE Sticky_PubSub SHALL use the default message TTL (24 hours)
7. WHEN a message expires, THE Sticky_PubSub SHALL exclude it from the collection during the next operation
8. THE Sticky_PubSub SHALL store the message before updating the coordinator (message survives conflicts)

### Requirement 3: Push Message Delivery

**User Story:** As a subscriber, I want to receive new messages immediately after they are published, so that I have real-time updates.

#### Acceptance Criteria

1. WHEN a message is published, THE Sticky_PubSub SHALL deliver it to all active subscribers
2. THE Sticky_PubSub SHALL use deterministic subscriber assignment to distribute delivery load across initiator nodes
3. THE Sticky_PubSub SHALL use the overlay messaging layer's encrypted sendMessage for push delivery
4. WHEN push delivery fails, THE Sticky_PubSub SHALL NOT retry (subscriber will receive via polling or reconnection)
5. THE Sticky_PubSub SHALL include the message's addedInVersion for client-side gap detection

### Requirement 4: Coordinator Management

**User Story:** As a system operator, I want topic state to be reliably stored and replicated, so that the system tolerates node failures.

#### Acceptance Criteria

1. THE Sticky_PubSub SHALL store the coordinator at k-closest nodes to hash(topicID)
2. THE Sticky_PubSub SHALL replicate coordinator updates to n closest nodes
3. THE Coordinator SHALL contain: version, currentSubscribers ID, currentMessages ID, subscriberHistory, messageHistory, previousCoordinator link
4. THE Coordinator SHALL maintain separate histories for subscriber and message collection IDs (last 10-50 entries)
5. WHEN the coordinator grows too large, THE Sticky_PubSub SHALL create a snapshot and prune history
6. THE Sticky_PubSub SHALL use the DHT put/get operations for coordinator storage

### Requirement 5: Immutable Collections

**User Story:** As a system architect, I want collections to be immutable, so that concurrent updates don't cause race conditions.

#### Acceptance Criteria

1. THE Subscriber_Collection SHALL be immutable (copy-on-write updates)
2. THE Message_Collection SHALL be immutable (copy-on-write updates)
3. WHEN updating a collection, THE Sticky_PubSub SHALL create a new collection with a new collection ID
4. THE Collection_ID SHALL be derived from the collection content (content-addressed)
5. THE Sticky_PubSub SHALL store collections at random DHT locations (not predictable from topic ID)
6. THE Sticky_PubSub SHALL set collection TTL based on content expiry (max item expiry + grace period)

### Requirement 6: Conflict Resolution

**User Story:** As a system operator, I want concurrent updates to be merged correctly, so that no messages or subscribers are lost.

#### Acceptance Criteria

1. WHEN a version conflict is detected during coordinator update, THE Sticky_PubSub SHALL merge the conflicting states
2. THE Sticky_PubSub SHALL merge message collections by union (all messages from both versions)
3. THE Sticky_PubSub SHALL merge subscriber collections by union (all subscribers from both versions)
4. THE Sticky_PubSub SHALL use collection ID histories to find common ancestors for merging
5. WHEN merge fails after 10 attempts, THE Sticky_PubSub SHALL trigger catastrophic recovery
6. THE Sticky_PubSub SHALL use optimistic concurrency with infinite retry (failure is not an option)

### Requirement 7: Subscription Renewal

**User Story:** As a subscriber, I want to renew my subscription before it expires, so that I continue receiving messages.

#### Acceptance Criteria

1. WHEN a subscriber calls renew with a topic ID, THE Sticky_PubSub SHALL extend the subscription expiry
2. THE Sticky_PubSub SHALL require a cryptographic signature for renewal (using node's private key)
3. THE Sticky_PubSub SHALL verify the signature against the subscriber's node ID
4. THE Sticky_PubSub SHALL reject renewal requests with timestamps older than 5 minutes (replay protection)
5. WHEN renewal is successful, THE Sticky_PubSub SHALL return the new expiry time

### Requirement 8: Client Recovery

**User Story:** As a subscriber, I want to detect and recover from missed messages, so that I have a complete message history.

#### Acceptance Criteria

1. THE Sticky_PubSub client SHALL track the last seen coordinator version
2. WHEN a version gap is detected (received version > lastSeen + 1), THE client SHALL request a full update
3. THE Sticky_PubSub SHALL support requestFullUpdate(fromVersion) to fetch missed messages
4. THE client SHALL deduplicate messages by message ID to handle push + polling overlap
5. THE client SHALL detect dropped messages using per-publisher sequence numbers

### Requirement 9: Garbage Collection

**User Story:** As a system operator, I want expired data to be cleaned up automatically, so that storage doesn't grow unbounded.

#### Acceptance Criteria

1. THE Sticky_PubSub SHALL remove expired subscribers during subscribe/publish operations (lazy cleanup)
2. THE Sticky_PubSub SHALL remove expired messages during subscribe/publish operations (lazy cleanup)
3. WHEN all subscribers and messages have expired, THE Sticky_PubSub SHALL delete the coordinator
4. THE Sticky_PubSub SHALL NOT require periodic background scans for cleanup
5. THE Coordinator_Snapshot SHALL have a TTL of 1 hour
6. THE Subscriber_Collection SHALL have a TTL equal to max(subscriber expiry times) + grace period
7. THE Message_Collection SHALL have a TTL equal to max(message expiry times) + grace period
8. WHEN a collection's TTL expires, THE DHT SHALL automatically remove it (no explicit deletion needed)
9. THE Sticky_PubSub SHALL set collection TTL at creation time based on content expiry

### Requirement 10: Configuration

**User Story:** As a node operator, I want to configure pub/sub parameters, so that I can tune performance for my use case.

#### Acceptance Criteria

1. THE Sticky_PubSub configuration SHALL include defaultSubscriptionTTL (default 30 minutes)
2. THE Sticky_PubSub configuration SHALL include defaultMessageTTL (default 24 hours)
3. THE Sticky_PubSub configuration SHALL include maxHistorySize for coordinator history (default 50)
4. THE Sticky_PubSub configuration SHALL include replicationFactor for coordinator replication (default 3)
5. THE Sticky_PubSub configuration SHALL include snapshotThreshold for when to create snapshots (default 100 entries)
6. WHEN configuration is not provided, THE Sticky_PubSub SHALL use sensible defaults

### Requirement 11: Error Handling

**User Story:** As a developer, I want clear error messages when operations fail, so that I can diagnose and handle failures.

#### Acceptance Criteria

1. WHEN a topic is not found, THE Sticky_PubSub SHALL reject with a TOPIC_NOT_FOUND error
2. WHEN subscription renewal signature is invalid, THE Sticky_PubSub SHALL reject with an INVALID_SIGNATURE error
3. WHEN a subscriber is not found during renewal, THE Sticky_PubSub SHALL reject with a NOT_SUBSCRIBED error
4. WHEN coordinator merge fails catastrophically, THE Sticky_PubSub SHALL reject with a MERGE_FAILED error
5. WHEN message storage fails, THE Sticky_PubSub SHALL reject with a STORAGE_FAILED error
6. IF an invalid message is received via push, THEN THE client SHALL drop it silently and log a warning

### Requirement 12: Unsubscribe

**User Story:** As a subscriber, I want to unsubscribe from a topic, so that I stop receiving messages and free up resources.

#### Acceptance Criteria

1. WHEN a subscriber calls unsubscribe with a topic ID, THE Sticky_PubSub SHALL remove the subscriber from the collection
2. THE Sticky_PubSub SHALL require a cryptographic signature for unsubscribe (using node's private key)
3. WHEN unsubscribe is successful, THE Sticky_PubSub SHALL stop delivering messages to that subscriber
4. THE Sticky_PubSub SHALL NOT require unsubscribe (subscriptions expire naturally via TTL)
