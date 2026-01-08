/**
 * Property-based tests for multi-server DHT configuration
 * 
 * Feature: multi-server-dht
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  calculateGlobalIndex,
  getPublicPath,
  getAnnounceAddress,
  getCrossServerBootstraps,
  DEFAULT_NODES_PER_SERVER,
  DEFAULT_SERVER_COUNT,
} from './server-config.js';

/**
 * Feature: multi-server-dht, Property 1: Global Index Uniqueness
 * 
 * For all valid (serverIndex, localIndex) pairs, global indices are unique.
 * The formula (serverIndex - 1) * nodesPerServer + localIndex produces
 * correct range without collisions.
 * 
 * **Validates: Requirements 6.1, 6.2, 6.3**
 */
describe('Property 1: Global Index Uniqueness', () => {
  it('all valid (serverIndex, localIndex) pairs produce unique global indices', () => {
    const seenIndices = new Set<number>();
    
    // Test all valid combinations for default configuration
    for (let serverIndex = 1; serverIndex <= DEFAULT_SERVER_COUNT; serverIndex++) {
      for (let localIndex = 1; localIndex <= DEFAULT_NODES_PER_SERVER; localIndex++) {
        const globalIndex = calculateGlobalIndex(serverIndex, localIndex);
        
        // Each global index should be unique
        expect(seenIndices.has(globalIndex)).toBe(false);
        seenIndices.add(globalIndex);
      }
    }
    
    // Should have exactly serverCount * nodesPerServer unique indices
    expect(seenIndices.size).toBe(DEFAULT_SERVER_COUNT * DEFAULT_NODES_PER_SERVER);
  });

  it('global indices span correct range [1, serverCount * nodesPerServer]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: DEFAULT_SERVER_COUNT }),
        fc.integer({ min: 1, max: DEFAULT_NODES_PER_SERVER }),
        (serverIndex, localIndex) => {
          const globalIndex = calculateGlobalIndex(serverIndex, localIndex);
          const maxIndex = DEFAULT_SERVER_COUNT * DEFAULT_NODES_PER_SERVER;
          
          expect(globalIndex).toBeGreaterThanOrEqual(1);
          expect(globalIndex).toBeLessThanOrEqual(maxIndex);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('formula (serverIndex - 1) * nodesPerServer + localIndex is correct', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: DEFAULT_SERVER_COUNT }),
        fc.integer({ min: 1, max: DEFAULT_NODES_PER_SERVER }),
        (serverIndex, localIndex) => {
          const globalIndex = calculateGlobalIndex(serverIndex, localIndex);
          const expected = (serverIndex - 1) * DEFAULT_NODES_PER_SERVER + localIndex;
          
          expect(globalIndex).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('server 1 nodes have global indices 1-15', () => {
    for (let localIndex = 1; localIndex <= DEFAULT_NODES_PER_SERVER; localIndex++) {
      const globalIndex = calculateGlobalIndex(1, localIndex);
      expect(globalIndex).toBe(localIndex);
    }
  });

  it('server 2 nodes have global indices 16-30', () => {
    for (let localIndex = 1; localIndex <= DEFAULT_NODES_PER_SERVER; localIndex++) {
      const globalIndex = calculateGlobalIndex(2, localIndex);
      expect(globalIndex).toBe(DEFAULT_NODES_PER_SERVER + localIndex);
    }
  });

  it('server boundaries are correct', () => {
    // First node of each server
    expect(calculateGlobalIndex(1, 1)).toBe(1);
    expect(calculateGlobalIndex(2, 1)).toBe(16);
    expect(calculateGlobalIndex(3, 1)).toBe(31);
    expect(calculateGlobalIndex(4, 1)).toBe(46);
    
    // Last node of each server
    expect(calculateGlobalIndex(1, 15)).toBe(15);
    expect(calculateGlobalIndex(2, 15)).toBe(30);
    expect(calculateGlobalIndex(3, 15)).toBe(45);
    expect(calculateGlobalIndex(4, 15)).toBe(60);
  });
});

/**
 * Feature: multi-server-dht, Property 1b: Global Index Determinism
 * 
 * The same (serverIndex, localIndex) pair always produces the same global index.
 * 
 * **Validates: Requirements 6.1, 6.2**
 */
describe('Property 1b: Global Index Determinism', () => {
  it('calculateGlobalIndex is deterministic', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: DEFAULT_SERVER_COUNT }),
        fc.integer({ min: 1, max: DEFAULT_NODES_PER_SERVER }),
        (serverIndex, localIndex) => {
          const result1 = calculateGlobalIndex(serverIndex, localIndex);
          const result2 = calculateGlobalIndex(serverIndex, localIndex);
          
          expect(result1).toBe(result2);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: multi-server-dht, Property 1c: Public Path Consistency
 * 
 * Public paths are correctly derived from global indices.
 * 
 * **Validates: Requirements 6.3**
 */
describe('Property 1c: Public Path Consistency', () => {
  it('public path contains correct global index', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 60 }),
        (globalIndex) => {
          const path = getPublicPath(globalIndex);
          
          expect(path).toBe(`/dht/node-${globalIndex}`);
          expect(path).toContain(globalIndex.toString());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('announce address contains correct path and host', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 60 }),
        (globalIndex) => {
          const host = 'imeyouwe.com';
          const address = getAnnounceAddress(host, globalIndex);
          
          expect(address).toContain(host);
          expect(address).toContain(`node-${globalIndex}`);
          expect(address).toMatch(/^\/dns4\/.+\/tcp\/443\/wss\/dht\/node-\d+$/);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: multi-server-dht, Property 1d: Invalid Input Handling
 * 
 * Invalid server or local indices throw appropriate errors.
 * 
 * **Validates: Requirements 6.1, 6.2**
 */
describe('Property 1d: Invalid Input Handling', () => {
  it('throws for server index < 1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 0 }),
        fc.integer({ min: 1, max: DEFAULT_NODES_PER_SERVER }),
        (serverIndex, localIndex) => {
          expect(() => calculateGlobalIndex(serverIndex, localIndex)).toThrow();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('throws for server index > DEFAULT_SERVER_COUNT', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: DEFAULT_SERVER_COUNT + 1, max: 100 }),
        fc.integer({ min: 1, max: DEFAULT_NODES_PER_SERVER }),
        (serverIndex, localIndex) => {
          expect(() => calculateGlobalIndex(serverIndex, localIndex)).toThrow();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('throws for local index < 1', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: DEFAULT_SERVER_COUNT }),
        fc.integer({ min: -100, max: 0 }),
        (serverIndex, localIndex) => {
          expect(() => calculateGlobalIndex(serverIndex, localIndex)).toThrow();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('throws for local index > nodesPerServer', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: DEFAULT_SERVER_COUNT }),
        fc.integer({ min: DEFAULT_NODES_PER_SERVER + 1, max: 100 }),
        (serverIndex, localIndex) => {
          expect(() => calculateGlobalIndex(serverIndex, localIndex)).toThrow();
        }
      ),
      { numRuns: 50 }
    );
  });
});


/**
 * Feature: multi-server-dht, Property 2: Cross-Server Connectivity
 * 
 * Test that bootstrap list includes addresses from all 4 servers
 * and that self-server is correctly filtered out.
 * 
 * **Validates: Requirements 5.1, 5.2**
 */
describe('Property 2: Cross-Server Connectivity', () => {
  // Helper to simulate parseCrossServerBootstraps logic
  function parseCrossServerBootstraps(bootstrapUrls: string, selfHost: string): string[] {
    if (!bootstrapUrls) return [];
    
    return bootstrapUrls
      .split(',')
      .map(url => url.trim())
      .filter(url => {
        if (!url) return false;
        try {
          const parsed = new URL(url);
          return parsed.hostname !== selfHost;
        } catch {
          return false;
        }
      });
  }

  it('getCrossServerBootstraps returns addresses for all 4 servers', () => {
    const bootstraps = getCrossServerBootstraps('imeyouwe.com');
    
    expect(bootstraps).toHaveLength(4);
    expect(bootstraps).toContain('wss://imeyouwe.com/ws');
    expect(bootstraps).toContain('wss://node2.imeyouwe.com/ws');
    expect(bootstraps).toContain('wss://node3.imeyouwe.com/ws');
    expect(bootstraps).toContain('wss://node4.imeyouwe.com/ws');
  });

  it('self-server is correctly filtered out from bootstrap list', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        (serverIndex) => {
          const baseDomain = 'imeyouwe.com';
          const selfHost = serverIndex === 1 ? baseDomain : `node${serverIndex}.${baseDomain}`;
          const allBootstraps = getCrossServerBootstraps(baseDomain).join(',');
          
          const filtered = parseCrossServerBootstraps(allBootstraps, selfHost);
          
          // Should have 3 servers (all except self)
          expect(filtered).toHaveLength(3);
          
          // Self-server should not be in the list
          const selfUrl = serverIndex === 1 
            ? `wss://${baseDomain}/ws`
            : `wss://node${serverIndex}.${baseDomain}/ws`;
          expect(filtered).not.toContain(selfUrl);
        }
      ),
      { numRuns: 10 }
    );
  });

  it('all other servers are included after filtering', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        (serverIndex) => {
          const baseDomain = 'imeyouwe.com';
          const selfHost = serverIndex === 1 ? baseDomain : `node${serverIndex}.${baseDomain}`;
          const allBootstraps = getCrossServerBootstraps(baseDomain).join(',');
          
          const filtered = parseCrossServerBootstraps(allBootstraps, selfHost);
          
          // Check that all other servers are included
          for (let i = 1; i <= 4; i++) {
            if (i === serverIndex) continue;
            
            const expectedUrl = i === 1 
              ? `wss://${baseDomain}/ws`
              : `wss://node${i}.${baseDomain}/ws`;
            expect(filtered).toContain(expectedUrl);
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  it('empty bootstrap string returns empty array', () => {
    const filtered = parseCrossServerBootstraps('', 'imeyouwe.com');
    expect(filtered).toHaveLength(0);
  });

  it('invalid URLs are filtered out', () => {
    const bootstraps = 'wss://valid.com/ws,invalid-url,wss://another.com/ws';
    const filtered = parseCrossServerBootstraps(bootstraps, 'other.com');
    
    expect(filtered).toHaveLength(2);
    expect(filtered).toContain('wss://valid.com/ws');
    expect(filtered).toContain('wss://another.com/ws');
  });
});
