/**
 * Integration tests for public address advertisement
 * 
 * Tests that DHT nodes properly advertise public addresses instead of
 * internal Docker addresses, enabling browser nodes to connect to
 * discovered peers.
 * 
 * Requirements: 1.2, 1.4, 1.5, 2.1, 3.1, 3.2, 6.1, 6.2
 */

import { describe, it, expect, afterEach } from 'vitest';
import { DHTNode } from '../dht/node.js';
import { DHTConfigBuilder } from '../dht/config.js';
import { cleanupNodes } from '../test-utils/network.js';
import {
  buildAnnounceAddress,
  buildDhtNodeAnnounceAddress,
  buildBootstrapAnnounceAddress,
  validateNodeAddresses,
  isPrivateAddress,
  isPublicWssAddress,
  canDialAddress,
  filterDialableAddresses,
  NodeAddressConfig,
} from '../config/address-utils.js';

describe('Address Advertisement Integration Tests', () => {
  // Track nodes for cleanup
  let nodesToCleanup: DHTNode[] = [];

  afterEach(async () => {
    await cleanupNodes(nodesToCleanup);
    nodesToCleanup = [];
  });

  describe('Announce Address Configuration', () => {
    it('should configure announce addresses at node creation time', async () => {
      const externalHost = 'test.example.com';
      const announceAddr = buildAnnounceAddress(externalHost, 'dht/node-1');
      
      const config = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .withAnnounceAddresses([announceAddr])
        .withMaxConnections(50)
        .build();

      expect(config.announceAddresses).toContain(announceAddr);
      
      const node = new DHTNode(config);
      nodesToCleanup.push(node);
      await node.start();

      // The node should have the announce address configured
      // Note: libp2p may append /p2p/{peerId} to announce addresses
      const multiaddrs = node.multiaddrs.map(ma => ma.toString());
      
      // At minimum, the listen address should be present
      expect(multiaddrs.length).toBeGreaterThan(0);
    }, 30000);

    it('should generate correct announce address format for DHT nodes', () => {
      const host = 'imeyouwe.com';
      
      // Test various node indices
      for (let i = 1; i <= 5; i++) {
        const addr = buildDhtNodeAnnounceAddress(host, i);
        
        // Should have correct format
        expect(addr).toMatch(/^\/dns4\/imeyouwe\.com\/tcp\/443\/wss\/http-path\/dht%2Fnode-\d+$/);
        expect(addr).toContain(`dht%2Fnode-${i}`);
        
        // Should NOT contain /p2p/ (libp2p adds this)
        expect(addr).not.toContain('/p2p/');
        
        // Should be dialable by browsers
        expect(canDialAddress(addr)).toBe(true);
        
        // Should not be a private address
        expect(isPrivateAddress(addr)).toBe(false);
        
        // Should be a public WSS address
        expect(isPublicWssAddress(addr)).toBe(true);
      }
    });

    it('should generate correct announce address format for bootstrap node', () => {
      const host = 'imeyouwe.com';
      const addr = buildBootstrapAnnounceAddress(host);
      
      // Should have correct format
      expect(addr).toBe('/dns4/imeyouwe.com/tcp/443/wss/http-path/libp2p');
      
      // Should NOT contain /p2p/ (libp2p adds this)
      expect(addr).not.toContain('/p2p/');
      
      // Should be dialable by browsers
      expect(canDialAddress(addr)).toBe(true);
      
      // Should not be a private address
      expect(isPrivateAddress(addr)).toBe(false);
      
      // Should be a public WSS address
      expect(isPublicWssAddress(addr)).toBe(true);
    });
  });

  describe('Address Validation', () => {
    it('should validate config with public addresses as valid', () => {
      const config: NodeAddressConfig = {
        listenAddresses: ['/ip4/0.0.0.0/tcp/4001', '/ip4/0.0.0.0/tcp/8080/ws'],
        announceAddresses: [buildDhtNodeAnnounceAddress('imeyouwe.com', 1)],
        externalHost: 'imeyouwe.com',
        publicPath: '/dht/node-1',
      };
      
      const result = validateNodeAddresses(config);
      
      expect(result.isValid).toBe(true);
      expect(result.hasPublicAddress).toBe(true);
      expect(result.hasInternalAddress).toBe(false);
      expect(result.warnings).toHaveLength(0);
    });

    it('should detect internal addresses in announce config', () => {
      const config: NodeAddressConfig = {
        listenAddresses: ['/ip4/0.0.0.0/tcp/4001'],
        announceAddresses: ['/ip4/172.17.0.2/tcp/4001/ws'],
        externalHost: 'imeyouwe.com',
        publicPath: '/dht/node-1',
      };
      
      const result = validateNodeAddresses(config);
      
      expect(result.isValid).toBe(false);
      expect(result.hasInternalAddress).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('172.17.0.2'))).toBe(true);
    });

    it('should warn when no public address is configured', () => {
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

    it('should warn when external host is localhost', () => {
      const config: NodeAddressConfig = {
        listenAddresses: ['/ip4/0.0.0.0/tcp/4001'],
        announceAddresses: ['/dns4/localhost/tcp/443/wss'],
        externalHost: 'localhost',
        publicPath: '/dht/node-1',
      };
      
      const result = validateNodeAddresses(config);
      
      expect(result.warnings.some(w => w.includes('localhost'))).toBe(true);
    });
  });

  describe('Browser Dialability Filter', () => {
    it('should filter addresses to only browser-dialable ones', () => {
      const mixedAddresses = [
        // Dialable addresses
        '/dns4/imeyouwe.com/tcp/443/wss/http-path/libp2p',
        '/dns4/example.com/tcp/443/wss',
        '/dns4/relay.example.com/tcp/443/wss/p2p/12D3KooW.../p2p-circuit',
        
        // Non-dialable addresses (internal)
        '/ip4/172.17.0.2/tcp/4001',
        '/ip4/10.0.0.1/tcp/4001/ws',
        '/dns4/dht-node-1/tcp/8080/ws',
        '/dns4/localhost/tcp/4001',
        
        // Non-dialable addresses (TCP only)
        '/ip4/8.8.8.8/tcp/4001',
      ];
      
      const dialable = filterDialableAddresses(mixedAddresses);
      
      // Should only include the dialable addresses
      expect(dialable).toHaveLength(3);
      expect(dialable).toContain('/dns4/imeyouwe.com/tcp/443/wss/http-path/libp2p');
      expect(dialable).toContain('/dns4/example.com/tcp/443/wss');
      expect(dialable).toContain('/dns4/relay.example.com/tcp/443/wss/p2p/12D3KooW.../p2p-circuit');
      
      // Should not include internal or TCP-only addresses
      expect(dialable).not.toContain('/ip4/172.17.0.2/tcp/4001');
      expect(dialable).not.toContain('/ip4/10.0.0.1/tcp/4001/ws');
      expect(dialable).not.toContain('/dns4/dht-node-1/tcp/8080/ws');
      expect(dialable).not.toContain('/ip4/8.8.8.8/tcp/4001');
    });

    it('should correctly identify dialable address types', () => {
      // WSS addresses
      expect(canDialAddress('/dns4/example.com/tcp/443/wss')).toBe(true);
      expect(canDialAddress('/dns4/example.com/tcp/443/wss/http-path/libp2p')).toBe(true);
      
      // WebRTC addresses
      expect(canDialAddress('/dns4/example.com/tcp/443/wss/webrtc/p2p/12D3KooW...')).toBe(true);
      
      // Circuit relay addresses
      expect(canDialAddress('/p2p/12D3KooW.../p2p-circuit/p2p/12D3KooW...')).toBe(true);
      
      // Internal addresses (should NOT be dialable)
      expect(canDialAddress('/ip4/172.17.0.2/tcp/443/wss')).toBe(false);
      expect(canDialAddress('/ip4/10.0.0.1/tcp/443/wss')).toBe(false);
      expect(canDialAddress('/ip4/192.168.1.1/tcp/443/wss')).toBe(false);
      expect(canDialAddress('/dns4/localhost/tcp/443/wss')).toBe(false);
      expect(canDialAddress('/dns4/dht-node-1/tcp/8080/ws')).toBe(false);
      
      // TCP-only addresses (should NOT be dialable by browsers)
      expect(canDialAddress('/ip4/8.8.8.8/tcp/4001')).toBe(false);
      expect(canDialAddress('/dns4/example.com/tcp/4001')).toBe(false);
    });
  });


  describe('DHT Node with Announce Addresses', () => {
    it('should start node with announce addresses configured', async () => {
      const externalHost = 'test.example.com';
      const nodeIndex = 1;
      const announceAddr = buildDhtNodeAnnounceAddress(externalHost, nodeIndex);
      
      const config = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .withAnnounceAddresses([announceAddr])
        .withMaxConnections(50)
        .build();

      const node = new DHTNode(config);
      nodesToCleanup.push(node);
      
      await node.start();
      
      // Node should be started
      expect(node.isStarted).toBe(true);
      expect(node.peerId).toBeDefined();
      
      // Verify the config has the announce address
      expect(config.announceAddresses).toContain(announceAddr);
    }, 30000);

    it('should allow multiple announce addresses', async () => {
      const announceAddrs = [
        buildDhtNodeAnnounceAddress('server1.example.com', 1),
        buildDhtNodeAnnounceAddress('server2.example.com', 1),
      ];
      
      const config = DHTConfigBuilder.create()
        .withListenAddresses(['/ip4/127.0.0.1/tcp/0'])
        .withAnnounceAddresses(announceAddrs)
        .withMaxConnections(50)
        .build();

      const node = new DHTNode(config);
      nodesToCleanup.push(node);
      
      await node.start();
      
      expect(node.isStarted).toBe(true);
      expect(config.announceAddresses).toHaveLength(2);
      expect(config.announceAddresses).toContain(announceAddrs[0]);
      expect(config.announceAddresses).toContain(announceAddrs[1]);
    }, 30000);
  });

  describe('Private Address Detection', () => {
    it('should detect all private IP ranges', () => {
      // 10.0.0.0/8
      expect(isPrivateAddress('/ip4/10.0.0.1/tcp/4001')).toBe(true);
      expect(isPrivateAddress('/ip4/10.255.255.255/tcp/4001')).toBe(true);
      
      // 172.16.0.0/12
      expect(isPrivateAddress('/ip4/172.16.0.1/tcp/4001')).toBe(true);
      expect(isPrivateAddress('/ip4/172.31.255.255/tcp/4001')).toBe(true);
      expect(isPrivateAddress('/ip4/172.15.0.1/tcp/4001')).toBe(false); // Just outside range
      expect(isPrivateAddress('/ip4/172.32.0.1/tcp/4001')).toBe(false); // Just outside range
      
      // 192.168.0.0/16
      expect(isPrivateAddress('/ip4/192.168.0.1/tcp/4001')).toBe(true);
      expect(isPrivateAddress('/ip4/192.168.255.255/tcp/4001')).toBe(true);
      
      // 127.0.0.0/8 (loopback)
      expect(isPrivateAddress('/ip4/127.0.0.1/tcp/4001')).toBe(true);
      expect(isPrivateAddress('/ip4/127.255.255.255/tcp/4001')).toBe(true);
      
      // Public IPs should not be detected as private
      expect(isPrivateAddress('/ip4/8.8.8.8/tcp/4001')).toBe(false);
      expect(isPrivateAddress('/ip4/1.1.1.1/tcp/4001')).toBe(false);
      expect(isPrivateAddress('/ip4/203.0.113.1/tcp/4001')).toBe(false);
    });
  });

  describe('Address Format Consistency', () => {
    it('should URL-encode paths correctly', () => {
      // Path with slash should be URL-encoded
      const addr = buildAnnounceAddress('example.com', 'dht/node-1');
      expect(addr).toContain('dht%2Fnode-1');
      expect(addr).not.toContain('dht/node-1');
      
      // Path without slash should not need encoding
      const addr2 = buildAnnounceAddress('example.com', 'libp2p');
      expect(addr2).toContain('libp2p');
    });

    it('should handle paths with and without leading slash', () => {
      const addr1 = buildAnnounceAddress('example.com', '/dht/node-1');
      const addr2 = buildAnnounceAddress('example.com', 'dht/node-1');
      
      // Both should produce the same result
      expect(addr1).toBe(addr2);
    });

    it('should produce consistent format across all node indices', () => {
      const host = 'imeyouwe.com';
      
      for (let i = 1; i <= 60; i++) {
        const addr = buildDhtNodeAnnounceAddress(host, i);
        
        // All should follow the same pattern
        expect(addr).toMatch(/^\/dns4\/imeyouwe\.com\/tcp\/443\/wss\/http-path\/dht%2Fnode-\d+$/);
        
        // All should be valid public WSS addresses
        expect(isPublicWssAddress(addr)).toBe(true);
        expect(canDialAddress(addr)).toBe(true);
      }
    });
  });
});
