# Implementation Plan: Public Address Advertisement

## Overview

This implementation fixes the peer discovery issue by ensuring all server-side nodes advertise public nginx addresses instead of internal Docker addresses. The key change is using `withAnnounceAddresses()` at node creation time rather than `addObservedAddr()` after start.

## Tasks

- [-] 1. Create address utility functions
  - [x] 1.1 Create `src/config/address-utils.ts` with address generation and validation functions ✓
    - Implement `buildAnnounceAddress(host: string, path: string): string`
    - Implement `validateNodeAddresses(config: NodeAddressConfig): AddressValidationResult`
    - Implement `isPrivateAddress(addr: string): boolean`
    - Implement `canDialAddress(addr: string): boolean` for browser filtering
    - _Requirements: 1.2, 1.4, 1.5, 1b.5, 3.4_

  - [x] 1.2 Write property tests for address utilities ✓
    - **Property 1: Server Node Address Format Validity**
    - **Property 2: No Private Addresses in Announce Configuration**
    - **Property 3: Address Dialability Filter**
    - **Property 4: Address Validation Correctness**
    - **Property 5: DHT Node Index to Path Mapping**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1b.5, 3.1, 3.2, 3.4, 4.3, 5.3, 6.2, 6.4**

- [x] 1. Create address utility functions ✓

- [-] 2. Update DHT node configuration (node.ts)
  - [x] 2.1 Modify node.ts to use `withAnnounceAddresses()` at configuration time ✓
    - Import address utilities
    - Build announce address before creating DHTConfigBuilder
    - Remove the `addObservedAddr()` code after node start
    - _Requirements: 1.1, 1.2, 3.1, 3.2_

  - [x] 2.2 Add address validation on startup ✓
    - Validate announce addresses using `validateNodeAddresses()`
    - Log warning if advertising internal addresses
    - _Requirements: 6.3_

- [x] 2. Update DHT node configuration (node.ts) ✓

- [-] 3. Update bootstrap node configuration (ws-bridge.ts)
  - [x] 3.1 Modify ws-bridge.ts to use `withAnnounceAddresses()` at configuration time ✓
    - Build announce address as `/dns4/{EXTERNAL_HOST}/tcp/443/wss/http-path/libp2p`
    - Configure before node creation
    - _Requirements: 2.1, 2.3_

  - [x] 3.2 Update /browser/config endpoint to return correct bootstrap addresses ✓
    - Ensure bootstrap peer addresses use public format
    - _Requirements: 2.2_

- [x] 3. Update bootstrap node configuration (ws-bridge.ts) ✓

- [x] 4. Checkpoint - Verify server nodes advertise public addresses ✓
  - All property tests pass (32 tests)
  - All integration tests pass (15 tests)
  - Deploy to test environment and verify /info endpoint shows public addresses

- [x] 5. Update browser node address handling ✓
  - [x] 5.1 Add address filtering to browser-node.ts ✓
    - Import `canDialAddress()` from address utilities
    - Filter received peer addresses before attempting to dial
    - _Requirements: 1b.5, 4.3_

  - [x] 5.2 Update browser node to not configure static announce addresses ✓
    - Verify browser node config doesn't set announceAddresses
    - _Requirements: 1b.1_

- [x] 6. Enhance /info endpoint for debugging ✓
  - [x] 6.1 Update /info endpoint in node.ts to include address validation info ✓
    - Add `announceAddresses` field
    - Add `isAdvertisingPublicAddress` boolean
    - Add `addressValidation` with warnings
    - _Requirements: 6.1, 6.2_

  - [x] 6.2 Update /info endpoint in ws-bridge.ts similarly ✓
    - Same fields as node.ts
    - _Requirements: 6.1, 6.2_

- [x] 7. Checkpoint - Full integration verification ✓
  - All tests pass (32 property tests + 15 integration tests)
  - Test browser node can discover and connect to multiple DHT nodes

- [x] 8. Write integration tests ✓
  - [x] 8.1 Write integration test for node address advertisement ✓
    - Start node with test config
    - Query /info endpoint
    - Verify announce addresses are public format
    - _Requirements: 6.1_

  - [x] 8.2 Write integration test for browser peer discovery ✓
    - Start multiple server nodes
    - Connect browser node
    - Verify browser discovers and connects to multiple peers
    - _Requirements: 4.2, 4.4_

## Notes

- All tasks are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- The key fix is in tasks 2.1 and 3.1 - using `withAnnounceAddresses()` instead of `addObservedAddr()`
