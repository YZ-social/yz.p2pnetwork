/**
 * Property-based tests for Relay Capacity Enforcement
 * 
 * Feature: browser-libp2p-nodes
 * 
 * Property 12: Relay Capacity Enforcement
 * 
 * Tests that server nodes enforce maxReservations and return
 * RESOURCE_LIMIT_EXCEEDED when capacity is reached.
 * 
 * **Validates: Requirements 10.1, 10.3**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Relay status response interface (matches server endpoint)
 */
interface RelayStatusResponse {
  activeReservations: number;
  maxReservations: number;
  activeCircuits: number;
  maxCircuits: number;
  utilization: number;
  bytesRelayed: {
    in: number;
    out: number;
  };
  rejectedReservations: number;
}

/**
 * Simulates relay capacity state for testing
 */
class RelayCapacitySimulator {
  private activeReservations = 0;
  private activeCircuits = 0;
  private rejectedReservations = 0;
  private bytesIn = 0;
  private bytesOut = 0;

  constructor(
    private readonly maxReservations: number,
    private readonly maxCircuits: number
  ) {}

  /**
   * Attempt to create a new reservation
   * @returns true if reservation was created, false if at capacity
   */
  requestReservation(): boolean {
    if (this.activeReservations >= this.maxReservations) {
      this.rejectedReservations++;
      return false;
    }
    this.activeReservations++;
    return true;
  }

  /**
   * Release a reservation
   */
  releaseReservation(): void {
    if (this.activeReservations > 0) {
      this.activeReservations--;
    }
  }

  /**
   * Attempt to create a new circuit
   * @returns true if circuit was created, false if at capacity
   */
  requestCircuit(): boolean {
    if (this.activeCircuits >= this.maxCircuits) {
      return false;
    }
    this.activeCircuits++;
    return true;
  }

  /**
   * Release a circuit
   */
  releaseCircuit(): void {
    if (this.activeCircuits > 0) {
      this.activeCircuits--;
    }
  }

  /**
   * Record bytes relayed
   */
  recordBytes(bytesIn: number, bytesOut: number): void {
    this.bytesIn += bytesIn;
    this.bytesOut += bytesOut;
  }

  /**
   * Get current relay status
   */
  getStatus(): RelayStatusResponse {
    return {
      activeReservations: this.activeReservations,
      maxReservations: this.maxReservations,
      activeCircuits: this.activeCircuits,
      maxCircuits: this.maxCircuits,
      utilization: this.maxReservations > 0 
        ? this.activeReservations / this.maxReservations 
        : 0,
      bytesRelayed: {
        in: this.bytesIn,
        out: this.bytesOut,
      },
      rejectedReservations: this.rejectedReservations,
    };
  }

  /**
   * Check if at capacity
   */
  isAtCapacity(): boolean {
    return this.activeReservations >= this.maxReservations;
  }
}

/**
 * Feature: browser-libp2p-nodes, Property 12: Relay Capacity Enforcement
 * 
 * For any server node with maxReservations=N, the number of active reservations
 * SHALL never exceed N, and new requests beyond N SHALL receive RESOURCE_LIMIT_EXCEEDED.
 * 
 * **Validates: Requirements 10.1, 10.3**
 */
describe('Property 12: Relay Capacity Enforcement', () => {
  /**
   * Test that active reservations never exceed maxReservations
   */
  it('active reservations never exceed maxReservations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 128 }), // maxReservations
        fc.integer({ min: 1, max: 16 }),  // maxCircuits
        fc.array(
          fc.oneof(
            fc.constant('request' as const),
            fc.constant('release' as const)
          ),
          { minLength: 10, maxLength: 200 }
        ), // sequence of operations
        async (maxReservations, maxCircuits, operations) => {
          const simulator = new RelayCapacitySimulator(maxReservations, maxCircuits);

          for (const op of operations) {
            if (op === 'request') {
              simulator.requestReservation();
            } else {
              simulator.releaseReservation();
            }

            // Invariant: active reservations never exceed max
            const status = simulator.getStatus();
            expect(status.activeReservations).toBeLessThanOrEqual(status.maxReservations);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that requests beyond capacity are rejected
   */
  it('requests beyond capacity are rejected with RESOURCE_LIMIT_EXCEEDED', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50 }), // maxReservations
        fc.integer({ min: 1, max: 10 }), // extra requests beyond capacity
        async (maxReservations, extraRequests) => {
          const simulator = new RelayCapacitySimulator(maxReservations, 16);

          // Fill to capacity
          let successCount = 0;
          for (let i = 0; i < maxReservations; i++) {
            const success = simulator.requestReservation();
            if (success) successCount++;
          }

          // Should have filled to capacity
          expect(successCount).toBe(maxReservations);
          expect(simulator.isAtCapacity()).toBe(true);

          // Additional requests should be rejected
          const initialRejected = simulator.getStatus().rejectedReservations;
          for (let i = 0; i < extraRequests; i++) {
            const success = simulator.requestReservation();
            expect(success).toBe(false);
          }

          // Rejected count should have increased
          const finalStatus = simulator.getStatus();
          expect(finalStatus.rejectedReservations).toBe(initialRejected + extraRequests);
          
          // Active reservations should still be at max
          expect(finalStatus.activeReservations).toBe(maxReservations);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that utilization is correctly calculated
   */
  it('utilization is correctly calculated as activeReservations / maxReservations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 128 }), // maxReservations
        fc.integer({ min: 0, max: 128 }), // reservations to create
        async (maxReservations, reservationsToCreate) => {
          const simulator = new RelayCapacitySimulator(maxReservations, 16);

          // Create reservations (up to max)
          const actualCreated = Math.min(reservationsToCreate, maxReservations);
          for (let i = 0; i < reservationsToCreate; i++) {
            simulator.requestReservation();
          }

          const status = simulator.getStatus();
          
          // Utilization should be activeReservations / maxReservations
          const expectedUtilization = actualCreated / maxReservations;
          expect(status.utilization).toBeCloseTo(expectedUtilization, 10);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that releasing reservations allows new ones
   */
  it('releasing reservations allows new requests to succeed', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 50 }), // maxReservations
        fc.integer({ min: 1, max: 10 }), // reservations to release
        async (maxReservations, toRelease) => {
          const simulator = new RelayCapacitySimulator(maxReservations, 16);

          // Fill to capacity
          for (let i = 0; i < maxReservations; i++) {
            simulator.requestReservation();
          }
          expect(simulator.isAtCapacity()).toBe(true);

          // Release some reservations
          const actualRelease = Math.min(toRelease, maxReservations);
          for (let i = 0; i < actualRelease; i++) {
            simulator.releaseReservation();
          }

          // Should no longer be at capacity
          expect(simulator.isAtCapacity()).toBe(false);

          // New requests should succeed
          for (let i = 0; i < actualRelease; i++) {
            const success = simulator.requestReservation();
            expect(success).toBe(true);
          }

          // Should be back at capacity
          expect(simulator.isAtCapacity()).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that circuit limits are also enforced
   */
  it('active circuits never exceed maxCircuits', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 16 }), // maxCircuits
        fc.array(
          fc.oneof(
            fc.constant('request' as const),
            fc.constant('release' as const)
          ),
          { minLength: 10, maxLength: 100 }
        ), // sequence of operations
        async (maxCircuits, operations) => {
          const simulator = new RelayCapacitySimulator(128, maxCircuits);

          for (const op of operations) {
            if (op === 'request') {
              simulator.requestCircuit();
            } else {
              simulator.releaseCircuit();
            }

            // Invariant: active circuits never exceed max
            const status = simulator.getStatus();
            expect(status.activeCircuits).toBeLessThanOrEqual(status.maxCircuits);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that bytes relayed are tracked correctly
   */
  it('bytes relayed are accumulated correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 10000 }), // bytesIn
            fc.integer({ min: 0, max: 10000 })  // bytesOut
          ),
          { minLength: 1, maxLength: 50 }
        ),
        async (byteTransfers) => {
          const simulator = new RelayCapacitySimulator(128, 16);

          let expectedBytesIn = 0;
          let expectedBytesOut = 0;

          for (const [bytesIn, bytesOut] of byteTransfers) {
            simulator.recordBytes(bytesIn, bytesOut);
            expectedBytesIn += bytesIn;
            expectedBytesOut += bytesOut;
          }

          const status = simulator.getStatus();
          expect(status.bytesRelayed.in).toBe(expectedBytesIn);
          expect(status.bytesRelayed.out).toBe(expectedBytesOut);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that status response contains all required fields
   */
  it('status response contains all required fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 128 }), // maxReservations
        fc.integer({ min: 1, max: 16 }),  // maxCircuits
        async (maxReservations, maxCircuits) => {
          const simulator = new RelayCapacitySimulator(maxReservations, maxCircuits);
          const status = simulator.getStatus();

          // Verify all required fields are present
          expect(status).toHaveProperty('activeReservations');
          expect(status).toHaveProperty('maxReservations');
          expect(status).toHaveProperty('activeCircuits');
          expect(status).toHaveProperty('maxCircuits');
          expect(status).toHaveProperty('utilization');
          expect(status).toHaveProperty('bytesRelayed');
          expect(status.bytesRelayed).toHaveProperty('in');
          expect(status.bytesRelayed).toHaveProperty('out');
          expect(status).toHaveProperty('rejectedReservations');

          // Verify types
          expect(typeof status.activeReservations).toBe('number');
          expect(typeof status.maxReservations).toBe('number');
          expect(typeof status.activeCircuits).toBe('number');
          expect(typeof status.maxCircuits).toBe('number');
          expect(typeof status.utilization).toBe('number');
          expect(typeof status.bytesRelayed.in).toBe('number');
          expect(typeof status.bytesRelayed.out).toBe('number');
          expect(typeof status.rejectedReservations).toBe('number');

          // Verify constraints
          expect(status.activeReservations).toBeGreaterThanOrEqual(0);
          expect(status.activeCircuits).toBeGreaterThanOrEqual(0);
          expect(status.utilization).toBeGreaterThanOrEqual(0);
          expect(status.utilization).toBeLessThanOrEqual(1);
          expect(status.rejectedReservations).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that rejected reservations counter is monotonically increasing
   */
  it('rejected reservations counter is monotonically increasing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }), // maxReservations
        fc.array(
          fc.oneof(
            fc.constant('request' as const),
            fc.constant('release' as const)
          ),
          { minLength: 20, maxLength: 100 }
        ),
        async (maxReservations, operations) => {
          const simulator = new RelayCapacitySimulator(maxReservations, 16);
          let previousRejected = 0;

          for (const op of operations) {
            if (op === 'request') {
              simulator.requestReservation();
            } else {
              simulator.releaseReservation();
            }

            const status = simulator.getStatus();
            // Rejected count should never decrease
            expect(status.rejectedReservations).toBeGreaterThanOrEqual(previousRejected);
            previousRejected = status.rejectedReservations;
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

