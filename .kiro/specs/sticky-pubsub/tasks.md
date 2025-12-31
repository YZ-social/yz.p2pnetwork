# Implementation Plan: Sticky Pub/Sub

## Overview

This implementation plan builds Sticky Pub/Sub incrementally, starting with core data structures, then operations, then client recovery. Each task builds on previous tasks, with property tests validating correctness at each step.

**Prerequisites:** The overlay-messaging layer must be implemented first.

## Tasks

- [ ] 1. Set up project structure and core types
  - Create `src/pubsub/` directory structure
  - Define TypeScript interfaces for all data models (Coordinator, Collections, Messages)
  - Define error types and error codes
  - Set up fast-check generators for property tests
  - _Requirements: 4.3, 11.1-11.6_

- [ ] 2. Implement Collection Manager
  - [ ] 2.1 Implement SubscriberCollection with content-addressed IDs
    - Create immutable subscriber collection class
    - Implement content-based ID generation (SHA-256 hash)
    - Implement TTL calculation (max expiry + grace period)
    - _Requirements: 5.1, 5.3, 5.4, 9.6_

  - [ ] 2.2 Write property test for SubscriberCollection
    - **Property 20: Collection Immutability**
    - **Property 22: Content-Addressed Collection IDs**
    - **Property 24: Collection TTL Based on Content**
    - **Validates: Requirements 5.1, 5.4, 9.6**

  - [ ] 2.3 Implement MessageCollection with content-addressed IDs
    - Create immutable message collection class
    - Implement content-based ID generation
    - Implement TTL calculation
    - _Requirements: 5.2, 5.3, 5.4, 9.7_

  - [ ] 2.4 Write property test for MessageCollection
    - **Property 20: Collection Immutability**
    - **Property 22: Content-Addressed Collection IDs**
    - **Property 24: Collection TTL Based on Content**
    - **Validates: Requirements 5.2, 5.4, 9.7**

  - [ ] 2.5 Implement collection merge operations (union semantics)
    - Implement mergeSubscriberCollections (union by clientId)
    - Implement mergeMessageCollections (union by messageId)
    - _Requirements: 6.2, 6.3_

  - [ ] 2.6 Write property test for collection merge
    - **Property 26: Merge by Union**
    - **Validates: Requirements 6.2, 6.3**

- [ ] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement Coordinator Manager
  - [ ] 4.1 Implement Coordinator data structure
    - Create coordinator class with all required fields
    - Implement version incrementing
    - Implement separate history tracking for subscriber/message collections
    - _Requirements: 4.3, 4.4_

  - [ ] 4.2 Write property test for Coordinator structure
    - **Property 17: Coordinator Structure**
    - **Property 18: Separate Collection Histories**
    - **Validates: Requirements 4.3, 4.4**

  - [ ] 4.3 Implement coordinator storage at k-closest nodes
    - Implement getOrCreate with DHT findNode + put/get
    - Implement replication to n closest nodes
    - _Requirements: 4.1, 4.2, 4.6_

  - [ ] 4.4 Write property test for coordinator storage
    - **Property 15: Coordinator at K-Closest Nodes**
    - **Property 16: Coordinator Replication**
    - **Validates: Requirements 4.1, 4.2**

  - [ ] 4.5 Implement snapshot creation and history pruning
    - Create CoordinatorSnapshot class
    - Implement snapshot creation when threshold exceeded
    - Implement history pruning after snapshot
    - _Requirements: 4.5, 9.5_

  - [ ] 4.6 Write property test for snapshot creation
    - **Property 19: Snapshot Creation on Threshold**
    - **Validates: Requirements 4.5**

  - [ ] 4.7 Implement optimistic concurrency with merge
    - Implement version conflict detection
    - Implement merge using collection histories
    - Implement common ancestor finding
    - Implement retry loop with exponential backoff
    - _Requirements: 6.1, 6.4, 6.6_

  - [ ] 4.8 Write property test for conflict resolution
    - **Property 25: Conflict Resolution via Merge**
    - **Property 27: Common Ancestor via History**
    - **Property 28: Optimistic Concurrency with Retry**
    - **Validates: Requirements 6.1, 6.4, 6.6**

- [ ] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement Subscribe Operation
  - [ ] 6.1 Implement basic subscribe flow
    - Load or create coordinator
    - Add subscriber to collection (copy-on-write)
    - Update coordinator version
    - Store at random DHT location
    - _Requirements: 1.1, 1.4, 1.5, 5.5_

  - [ ] 6.2 Write property test for subscribe
    - **Property 1: Subscribe Adds Subscriber**
    - **Property 4: Topic Creation on First Subscribe**
    - **Property 21: New Collection ID on Update**
    - **Property 23: Random Collection Storage**
    - **Validates: Requirements 1.1, 1.4, 5.3, 5.5**

  - [ ] 6.3 Implement historical message delivery
    - Load message collection
    - Filter non-expired messages
    - Deliver via overlay sendMessage (encrypted)
    - _Requirements: 1.2, 1.7_

  - [ ] 6.4 Write property test for historical delivery
    - **Property 2: Historical Message Delivery**
    - **Validates: Requirements 1.2**

  - [ ] 6.5 Implement delta delivery with lastSeenVersion
    - Filter messages by addedInVersion > lastSeenVersion
    - _Requirements: 1.3_

  - [ ] 6.6 Write property test for delta delivery
    - **Property 3: Delta Delivery**
    - **Validates: Requirements 1.3**

  - [ ] 6.7 Implement lazy cleanup of expired subscribers
    - Filter expired subscribers when creating new collection
    - _Requirements: 1.6, 9.1_

  - [ ] 6.8 Write property test for lazy cleanup
    - **Property 5: Lazy Cleanup of Expired Entries**
    - **Validates: Requirements 1.6, 9.1**

- [ ] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Implement Publish Operation
  - [ ] 8.1 Implement basic publish flow
    - Generate unique messageId and publisherSequence
    - Store message in DHT first
    - Update message collection (copy-on-write)
    - Update coordinator version
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.8_

  - [ ] 8.2 Write property test for publish
    - **Property 6: Publish Stores Message**
    - **Property 7: Publish Updates Collection**
    - **Property 8: Version Increment on Publish**
    - **Property 9: Unique Message IDs and Monotonic Sequences**
    - **Property 11: Message Stored Before Coordinator Update**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.8**

  - [ ] 8.3 Implement custom TTL support
    - Use provided TTL or default (24 hours)
    - Set message expiresAt accordingly
    - _Requirements: 2.5, 2.6_

  - [ ] 8.4 Write property test for custom TTL
    - **Property 10: Custom TTL Respected**
    - **Validates: Requirements 2.5**

  - [ ] 8.5 Implement lazy cleanup of expired messages
    - Filter expired messages when creating new collection
    - _Requirements: 2.7, 9.2_

  - [ ] 8.6 Write property test for message cleanup
    - **Property 5: Lazy Cleanup of Expired Entries** (message variant)
    - **Validates: Requirements 2.7, 9.2**

- [ ] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Implement Push Delivery
  - [ ] 10.1 Implement deterministic subscriber assignment
    - Hash subscriberId + topicId to assign to coordinator node
    - Distribute delivery load across initiator nodes
    - _Requirements: 3.2_

  - [ ] 10.2 Write property test for deterministic assignment
    - **Property 13: Deterministic Subscriber Assignment**
    - **Validates: Requirements 3.2**

  - [ ] 10.3 Implement push delivery to subscribers
    - Deliver to all active subscribers via overlay sendMessage
    - Include addedInVersion in message
    - No retry on failure
    - _Requirements: 3.1, 3.3, 3.4, 3.5_

  - [ ] 10.4 Write property test for push delivery
    - **Property 12: Push Delivery to Active Subscribers**
    - **Property 14: Messages Include Version Metadata**
    - **Validates: Requirements 3.1, 3.5**

- [ ] 11. Implement Renewal and Unsubscribe
  - [ ] 11.1 Implement signature verification
    - Verify Ed25519 signature against node ID
    - Implement timestamp validation (5 minute window)
    - _Requirements: 7.2, 7.3, 7.4, 12.2_

  - [ ] 11.2 Write property test for signature verification
    - **Property 30: Signature Verification**
    - **Property 31: Replay Protection**
    - **Validates: Requirements 7.2, 7.3, 7.4, 12.2**

  - [ ] 11.3 Implement renewal operation
    - Extend subscriber expiry
    - Return new expiry time
    - _Requirements: 7.1, 7.5_

  - [ ] 11.4 Write property test for renewal
    - **Property 29: Renewal Extends Expiry**
    - **Property 32: Renewal Returns New Expiry**
    - **Validates: Requirements 7.1, 7.5**

  - [ ] 11.5 Implement unsubscribe operation
    - Remove subscriber from collection
    - Stop message delivery
    - _Requirements: 12.1, 12.3_

  - [ ] 11.6 Write property test for unsubscribe
    - **Property 41: Unsubscribe Removes Subscriber**
    - **Property 42: Unsubscribe Stops Delivery**
    - **Validates: Requirements 12.1, 12.3**

  - [ ] 11.7 Implement natural subscription expiry
    - Verify subscriptions expire without explicit unsubscribe
    - _Requirements: 12.4_

  - [ ] 11.8 Write property test for natural expiry
    - **Property 43: Subscriptions Expire Naturally**
    - **Validates: Requirements 12.4**

- [ ] 12. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Implement Client Recovery
  - [ ] 13.1 Implement version tracking
    - Track lastSeenVersion per topic
    - Update on message receipt
    - _Requirements: 8.1_

  - [ ] 13.2 Write property test for version tracking
    - **Property 33: Client Tracks Version**
    - **Validates: Requirements 8.1**

  - [ ] 13.3 Implement gap detection and full update
    - Detect version gaps (received > lastSeen + 1)
    - Request full update from coordinator
    - _Requirements: 8.2, 8.3_

  - [ ] 13.4 Write property test for gap detection
    - **Property 34: Gap Detection**
    - **Property 35: Full Update Returns Missed Messages**
    - **Validates: Requirements 8.2, 8.3**

  - [ ] 13.5 Implement message deduplication
    - Track seen message IDs
    - Skip duplicate messages
    - _Requirements: 8.4_

  - [ ] 13.6 Write property test for deduplication
    - **Property 36: Message Deduplication**
    - **Validates: Requirements 8.4**

  - [ ] 13.7 Implement drop detection via sequences
    - Track per-publisher sequence numbers
    - Detect gaps in sequences
    - _Requirements: 8.5_

  - [ ] 13.8 Write property test for drop detection
    - **Property 37: Drop Detection via Sequences**
    - **Validates: Requirements 8.5**

- [ ] 14. Implement Garbage Collection
  - [ ] 14.1 Implement coordinator deletion on full expiry
    - Delete coordinator when all content expired
    - _Requirements: 9.3_

  - [ ] 14.2 Write property test for coordinator deletion
    - **Property 38: Coordinator Deletion on Full Expiry**
    - **Validates: Requirements 9.3**

  - [ ] 14.3 Implement DHT TTL for collections
    - Set collection TTL at creation time
    - Verify DHT auto-removes expired collections
    - _Requirements: 9.8, 9.9_

  - [ ] 14.4 Write property test for DHT TTL
    - **Property 39: DHT Auto-Removes Expired Collections**
    - **Validates: Requirements 9.8**

- [ ] 15. Implement StickyPubSub Facade
  - [ ] 15.1 Implement main facade with configuration
    - Create StickyPubSub class
    - Implement start/stop lifecycle
    - Apply default configuration
    - _Requirements: 10.1-10.6_

  - [ ] 15.2 Write property test for configuration
    - **Property 40: Default Configuration Applied**
    - **Validates: Requirements 10.6**

  - [ ] 15.3 Wire all components together
    - Integrate CoordinatorManager, CollectionManager, MessageDelivery, ClientRecovery
    - Implement onMessage/offMessage handlers
    - _Requirements: All_

- [ ] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 17. Integration tests
  - [ ] 17.1 Write end-to-end subscribe/publish test
    - Test full flow with multiple nodes
    - Verify historical message delivery
    - _Requirements: 1.1, 1.2, 2.1, 3.1_

  - [ ] 17.2 Write concurrent publish conflict test
    - Simulate concurrent publishers
    - Verify merge produces union of messages
    - _Requirements: 6.1, 6.2_

  - [ ] 17.3 Write subscription renewal test
    - Test renewal extends expiry
    - Test expired renewal is rejected
    - _Requirements: 7.1, 7.4_

## Notes

- All tasks are required (comprehensive testing from start)
- Each property test references specific design properties for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- overlay-messaging must be implemented before starting this spec
