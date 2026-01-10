/**
 * Property-based tests for address utility functions
 * 
 * Feature: public-address-advertisement
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  buildAnnounceAddress,
  buildDhtNodePath,
  buildDhtNodeAnnounceAddress,
  buildBootstrapAnnounceAddress,
  isPrivateAddress,
  isLocalhostAddress,
  isDockerInternalAddress,
  isInternalAddress,
  isPublicWssAddress,
  canDialAddress,
  filterDialableAddresses,
  validateNodeAddresses,
  NodeAddressConfig,
} from './address-utils.js';

// Arbitraries for generating test data
const validHostname = fc.stringMatching(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/);
const validPath = fc.stringMatching(/^[a-z][a-z0-9/-]*$/);
const nodeIndex = fc.integer({ min: 1, max: 60 });

/**
 * Feature: public-address-advertisement, Property 1: Server Node Address Format Validity
 * 
 * For any valid EXTERNAL_HOST and PUBLIC_PATH combination, the generated announce address SHALL:
 * - Start with `/dns4/{EXTERNAL_HOST}/tcp/443/wss/http-path/`
 * - Contain the URL-encoded PUBLIC_PATH
 * - NOT end with `/p2p/{peerId}` (libp2p appends this automatically)
 * 
 * **Validates: Requirements 1.2, 1.3, 3.1, 3.2**
 */
describe('Property 1: Server Node Address Format Validity', () => {
  it('buildAnnounceAddress produces correct format', () => {
    fc.assert(
      fc.property(validHostname, validPath, (host, path) => {
        const addr = buildAnnounceAddress(host, path);
        
        // Must start with /dns4/{host}/tcp/443/wss/http-path/
        expect(addr).toMatch(new RegExp(`^/dns4/${host}/tcp/443/wss/http-path/`));
        
        // Must contain URL-encoded path
        const encodedPath = encodeURIComponent(path);
        expect(addr).toContain(encodedPath);
        
        // Must NOT end with /p2p/{peerId}
        expect(addr).not.toMatch(/\/p2p\/[A-Za-z0-9]+$/);
      }),
      { numRuns: 100 }
    );
  });

  it('buildAnnounceAddress handles paths with leading slash', () => {
    const addr1 = buildAnnounceAddress('example.com', '/dht/node-1');
    const addr2 = buildAnnounceAddress('example.com', 'dht/node-1');
    
    // Both should produce the same result
    expect(addr1).toBe(addr2);
  });

  it('buildAnnounceAddress URL-encodes slashes in path', () => {
    const addr = buildAnnounceAddress('imeyouwe.com', 'dht/node-1');
    
    // The slash should be encoded as %2F
    expect(addr).toContain('dht%2Fnode-1');
    expect(addr).toBe('/dns4/imeyouwe.com/tcp/443/wss/http-path/dht%2Fnode-1');
  });

  it('buildDhtNodeAnnounceAddress produces correct format for all node indices', () => {
    fc.assert(
      fc.property(nodeIndex, (index) => {
        const addr = buildDhtNodeAnnounceAddress('imeyouwe.com', index);
        
        expect(addr).toMatch(/^\/dns4\/imeyouwe\.com\/tcp\/443\/wss\/http-path\/dht%2Fnode-\d+$/);
        expect(addr).toContain(`dht%2Fnode-${index}`);
      }),
      { numRuns: 60 }
    );
  });

  it('buildBootstrapAnnounceAddress produces correct format', () => {
    const addr = buildBootstrapAnnounceAddress('imeyouwe.com');
    
    expect(addr).toBe('/dns4/imeyouwe.com/tcp/443/wss/http-path/libp2p');
  });
});

/**
 * Feature: public-address-advertisement, Property 2: No Private Addresses in Announce Configuration
 * 
 * For any generated announce address configuration, the addresses SHALL NOT contain:
 * - Private IPv4 ranges (172.16-31.x.x, 10.x.x.x, 192.168.x.x)
 * - Localhost addresses (127.0.0.1, localhost)
 * - Docker internal DNS names (e.g., libp2p-bootstrap, dht-node-1)
 * 
 * **Validates: Requirements 1.4, 1.5**
 */
describe('Property 2: No Private Addresses in Announce Configuration', () => {
  it('isPrivateAddress detects 10.x.x.x range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (b, c, d) => {
          const addr = `/ip4/10.${b}.${c}.${d}/tcp/4001`;
          expect(isPrivateAddress(addr)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('isPrivateAddress detects 172.16-31.x.x range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 16, max: 31 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (b, c, d) => {
          const addr = `/ip4/172.${b}.${c}.${d}/tcp/4001`;
          expect(isPrivateAddress(addr)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('isPrivateAddress detects 192.168.x.x range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (c, d) => {
          const addr = `/ip4/192.168.${c}.${d}/tcp/4001`;
          expect(isPrivateAddress(addr)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('isPrivateAddress detects 127.x.x.x loopback range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (b, c, d) => {
          const addr = `/ip4/127.${b}.${c}.${d}/tcp/4001`;
          expect(isPrivateAddress(addr)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('isPrivateAddress returns false for public IPs', () => {
    const publicAddrs = [
      '/ip4/8.8.8.8/tcp/4001',
      '/ip4/1.1.1.1/tcp/4001',
      '/ip4/203.0.113.1/tcp/4001',
      '/ip4/198.51.100.1/tcp/4001',
    ];
    
    for (const addr of publicAddrs) {
      expect(isPrivateAddress(addr)).toBe(false);
    }
  });

  it('isLocalhostAddress detects localhost DNS', () => {
    expect(isLocalhostAddress('/dns4/localhost/tcp/4001')).toBe(true);
    expect(isLocalhostAddress('/dns/localhost/tcp/4001')).toBe(true);
    expect(isLocalhostAddress('/ip4/127.0.0.1/tcp/4001')).toBe(true);
  });

  it('isDockerInternalAddress detects Docker DNS names', () => {
    expect(isDockerInternalAddress('/dns4/libp2p-bootstrap/tcp/4001')).toBe(true);
    expect(isDockerInternalAddress('/dns4/dht-node-1/tcp/4001')).toBe(true);
    expect(isDockerInternalAddress('/dns4/dht-node-15/tcp/4001')).toBe(true);
    expect(isDockerInternalAddress('/dns/dht-node-5/tcp/4001')).toBe(true);
  });

  it('isInternalAddress combines all internal checks', () => {
    const internalAddrs = [
      '/ip4/10.0.0.1/tcp/4001',
      '/ip4/172.17.0.2/tcp/4001',
      '/ip4/192.168.1.1/tcp/4001',
      '/ip4/127.0.0.1/tcp/4001',
      '/dns4/localhost/tcp/4001',
      '/dns4/dht-node-1/tcp/4001',
      '/dns4/libp2p-bootstrap/tcp/4001',
    ];
    
    for (const addr of internalAddrs) {
      expect(isInternalAddress(addr)).toBe(true);
    }
  });

  it('generated announce addresses are never internal', () => {
    fc.assert(
      fc.property(validHostname, nodeIndex, (host, index) => {
        const addr = buildDhtNodeAnnounceAddress(host, index);
        expect(isInternalAddress(addr)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: public-address-advertisement, Property 3: Address Dialability Filter
 * 
 * For any list of multiaddrs, the browser dialability filter SHALL return only addresses that:
 * - Contain `/wss/` or end with `/wss` (WebSocket Secure)
 * - OR contain `/webrtc/` (WebRTC transport)
 * - OR contain `/p2p-circuit/` (Circuit relay)
 * 
 * And SHALL exclude addresses that:
 * - Contain only TCP without WebSocket (`/tcp/` without `/ws`)
 * - Contain private IP ranges
 * 
 * **Validates: Requirements 1b.5, 3.4, 4.3**
 */
describe('Property 3: Address Dialability Filter', () => {
  it('canDialAddress returns true for WSS addresses', () => {
    const wssAddrs = [
      '/dns4/imeyouwe.com/tcp/443/wss/http-path/libp2p',
      '/dns4/example.com/tcp/443/wss',
      '/dns4/test.com/tcp/443/wss/p2p/12D3KooW...',
    ];
    
    for (const addr of wssAddrs) {
      expect(canDialAddress(addr)).toBe(true);
    }
  });

  it('canDialAddress returns true for WebRTC addresses', () => {
    const webrtcAddrs = [
      '/dns4/example.com/tcp/443/wss/webrtc/p2p/12D3KooW...',
      '/ip4/1.2.3.4/udp/9090/webrtc-direct/p2p/12D3KooW...',
    ];
    
    for (const addr of webrtcAddrs) {
      expect(canDialAddress(addr)).toBe(true);
    }
  });

  it('canDialAddress returns true for circuit relay addresses', () => {
    const relayAddrs = [
      '/dns4/relay.example.com/tcp/443/wss/p2p/12D3KooW.../p2p-circuit/p2p/12D3KooW...',
      '/p2p/12D3KooW.../p2p-circuit/p2p/12D3KooW...',
    ];
    
    for (const addr of relayAddrs) {
      expect(canDialAddress(addr)).toBe(true);
    }
  });

  it('canDialAddress returns false for TCP-only addresses', () => {
    const tcpAddrs = [
      '/ip4/1.2.3.4/tcp/4001',
      '/dns4/example.com/tcp/4001',
      '/ip4/8.8.8.8/tcp/4001/p2p/12D3KooW...',
    ];
    
    for (const addr of tcpAddrs) {
      expect(canDialAddress(addr)).toBe(false);
    }
  });

  it('canDialAddress returns false for internal addresses even with WSS', () => {
    const internalWssAddrs = [
      '/ip4/10.0.0.1/tcp/443/wss',
      '/ip4/172.17.0.2/tcp/443/wss',
      '/ip4/192.168.1.1/tcp/443/wss',
      '/dns4/localhost/tcp/443/wss',
      '/dns4/dht-node-1/tcp/443/wss',
    ];
    
    for (const addr of internalWssAddrs) {
      expect(canDialAddress(addr)).toBe(false);
    }
  });

  it('filterDialableAddresses filters correctly', () => {
    const mixedAddrs = [
      '/dns4/imeyouwe.com/tcp/443/wss/http-path/libp2p',  // dialable
      '/ip4/10.0.0.1/tcp/4001',                           // internal TCP
      '/dns4/example.com/tcp/443/wss',                    // dialable
      '/ip4/172.17.0.2/tcp/443/wss',                      // internal WSS
      '/ip4/8.8.8.8/tcp/4001',                            // public TCP (not dialable)
    ];
    
    const dialable = filterDialableAddresses(mixedAddrs);
    
    expect(dialable).toHaveLength(2);
    expect(dialable).toContain('/dns4/imeyouwe.com/tcp/443/wss/http-path/libp2p');
    expect(dialable).toContain('/dns4/example.com/tcp/443/wss');
  });

  it('filterDialableAddresses returns empty array for all-internal list', () => {
    const internalAddrs = [
      '/ip4/10.0.0.1/tcp/4001',
      '/ip4/172.17.0.2/tcp/4001',
      '/dns4/dht-node-1/tcp/4001',
    ];
    
    expect(filterDialableAddresses(internalAddrs)).toHaveLength(0);
  });

  it('generated DHT node addresses are always dialable', () => {
    fc.assert(
      fc.property(validHostname, nodeIndex, (host, index) => {
        const addr = buildDhtNodeAnnounceAddress(host, index);
        expect(canDialAddress(addr)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Feature: public-address-advertisement, Property 4: Address Validation Correctness
 * 
 * For any NodeAddressConfig, the validation function SHALL:
 * - Return `hasPublicAddress: true` if and only if at least one address contains `/dns4/` AND `/wss/`
 * - Return `hasInternalAddress: true` if and only if at least one address matches private IP patterns
 * - Return `isValid: true` if and only if `hasPublicAddress && !hasInternalAddress`
 * 
 * **Validates: Requirements 5.3, 6.2, 6.4**
 */
describe('Property 4: Address Validation Correctness', () => {
  it('validates config with only public addresses as valid', () => {
    const config: NodeAddressConfig = {
      listenAddresses: ['/ip4/0.0.0.0/tcp/4001'],
      announceAddresses: ['/dns4/imeyouwe.com/tcp/443/wss/http-path/dht%2Fnode-1'],
      externalHost: 'imeyouwe.com',
      publicPath: '/dht/node-1',
    };
    
    const result = validateNodeAddresses(config);
    
    expect(result.isValid).toBe(true);
    expect(result.hasPublicAddress).toBe(true);
    expect(result.hasInternalAddress).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it('validates config with internal addresses as invalid', () => {
    const config: NodeAddressConfig = {
      listenAddresses: ['/ip4/0.0.0.0/tcp/4001'],
      announceAddresses: ['/ip4/172.17.0.2/tcp/4001'],
      externalHost: 'imeyouwe.com',
      publicPath: '/dht/node-1',
    };
    
    const result = validateNodeAddresses(config);
    
    expect(result.isValid).toBe(false);
    expect(result.hasPublicAddress).toBe(false);
    expect(result.hasInternalAddress).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('validates config with mixed addresses as invalid', () => {
    const config: NodeAddressConfig = {
      listenAddresses: ['/ip4/0.0.0.0/tcp/4001'],
      announceAddresses: [
        '/dns4/imeyouwe.com/tcp/443/wss/http-path/dht%2Fnode-1',
        '/ip4/172.17.0.2/tcp/4001',
      ],
      externalHost: 'imeyouwe.com',
      publicPath: '/dht/node-1',
    };
    
    const result = validateNodeAddresses(config);
    
    expect(result.isValid).toBe(false);
    expect(result.hasPublicAddress).toBe(true);
    expect(result.hasInternalAddress).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('warns when externalHost is localhost', () => {
    const config: NodeAddressConfig = {
      listenAddresses: ['/ip4/0.0.0.0/tcp/4001'],
      announceAddresses: ['/dns4/localhost/tcp/443/wss'],
      externalHost: 'localhost',
      publicPath: '/dht/node-1',
    };
    
    const result = validateNodeAddresses(config);
    
    expect(result.warnings.some(w => w.includes('localhost'))).toBe(true);
  });

  it('warns when no public address is configured', () => {
    const config: NodeAddressConfig = {
      listenAddresses: ['/ip4/0.0.0.0/tcp/4001'],
      announceAddresses: [],
      externalHost: 'imeyouwe.com',
      publicPath: '/dht/node-1',
    };
    
    const result = validateNodeAddresses(config);
    
    expect(result.isValid).toBe(false);
    expect(result.hasPublicAddress).toBe(false);
    expect(result.warnings.some(w => w.includes('No public WSS address'))).toBe(true);
  });

  it('isValid is true iff hasPublicAddress && !hasInternalAddress', () => {
    const testCases: Array<{ announceAddresses: string[]; expectedValid: boolean }> = [
      { announceAddresses: ['/dns4/example.com/tcp/443/wss'], expectedValid: true },
      { announceAddresses: ['/ip4/10.0.0.1/tcp/4001'], expectedValid: false },
      { announceAddresses: [], expectedValid: false },
      { announceAddresses: ['/dns4/example.com/tcp/443/wss', '/ip4/10.0.0.1/tcp/4001'], expectedValid: false },
    ];
    
    for (const { announceAddresses, expectedValid } of testCases) {
      const config: NodeAddressConfig = {
        listenAddresses: [],
        announceAddresses,
        externalHost: 'example.com',
        publicPath: '/test',
      };
      
      const result = validateNodeAddresses(config);
      expect(result.isValid).toBe(expectedValid);
      expect(result.isValid).toBe(result.hasPublicAddress && !result.hasInternalAddress);
    }
  });
});

/**
 * Feature: public-address-advertisement, Property 5: DHT Node Index to Path Mapping
 * 
 * For any NODE_INDEX in range [1, 60], the generated public path SHALL be `/dht/node-{NODE_INDEX}`
 * and the URL-encoded form SHALL be `dht%2Fnode-{NODE_INDEX}`.
 * 
 * **Validates: Requirements 3.1, 3.2**
 */
describe('Property 5: DHT Node Index to Path Mapping', () => {
  it('buildDhtNodePath produces correct path for all indices', () => {
    fc.assert(
      fc.property(nodeIndex, (index) => {
        const path = buildDhtNodePath(index);
        expect(path).toBe(`dht/node-${index}`);
      }),
      { numRuns: 60 }
    );
  });

  it('URL-encoded path is correct for all indices', () => {
    fc.assert(
      fc.property(nodeIndex, (index) => {
        const path = buildDhtNodePath(index);
        const encoded = encodeURIComponent(path);
        expect(encoded).toBe(`dht%2Fnode-${index}`);
      }),
      { numRuns: 60 }
    );
  });

  it('buildDhtNodeAnnounceAddress contains correct encoded path', () => {
    fc.assert(
      fc.property(nodeIndex, (index) => {
        const addr = buildDhtNodeAnnounceAddress('imeyouwe.com', index);
        expect(addr).toContain(`dht%2Fnode-${index}`);
      }),
      { numRuns: 60 }
    );
  });

  it('specific boundary cases are correct', () => {
    expect(buildDhtNodePath(1)).toBe('dht/node-1');
    expect(buildDhtNodePath(15)).toBe('dht/node-15');
    expect(buildDhtNodePath(16)).toBe('dht/node-16');
    expect(buildDhtNodePath(30)).toBe('dht/node-30');
    expect(buildDhtNodePath(60)).toBe('dht/node-60');
  });
});
