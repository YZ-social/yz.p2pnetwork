/**
 * Tests for custom multiaddr protocol registration
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { multiaddr } from '@multiformats/multiaddr';

// Import the protocol registration module - this registers http-path
import './multiaddr-protocols.js';
import { isHttpPathRegistered } from './multiaddr-protocols.js';

describe('Multiaddr Protocol Registration', () => {
  beforeAll(() => {
    // Ensure protocol is registered
    expect(isHttpPathRegistered()).toBe(true);
  });

  describe('http-path protocol', () => {
    it('should be registered', () => {
      expect(isHttpPathRegistered()).toBe(true);
    });

    it('should parse multiaddr with http-path', () => {
      const addr = '/dns4/example.com/tcp/443/wss/http-path/libp2p';
      expect(() => multiaddr(addr)).not.toThrow();
      
      const ma = multiaddr(addr);
      expect(ma.toString()).toBe(addr);
    });

    it('should parse multiaddr with http-path and p2p', () => {
      const addr = '/dns4/example.com/tcp/443/wss/http-path/libp2p/p2p/12D3KooWQ8bH8j5AmpgXgdjLFp1R37YeMfh65mvK3cPxENcSvPbR';
      expect(() => multiaddr(addr)).not.toThrow();
      
      const ma = multiaddr(addr);
      expect(ma.toString()).toBe(addr);
    });

    it('should parse multiaddr with http-path and p2p-circuit', () => {
      const addr = '/dns4/example.com/tcp/443/wss/http-path/libp2p/p2p/12D3KooWQ8bH8j5AmpgXgdjLFp1R37YeMfh65mvK3cPxENcSvPbR/p2p-circuit/p2p/12D3KooWH26HEwG9UHfXLmZMnegTiiW32HM9bNdQruZoTBRu4VYs';
      expect(() => multiaddr(addr)).not.toThrow();
      
      const ma = multiaddr(addr);
      expect(ma.toString()).toBe(addr);
    });

    it('should parse multiaddr with URL-encoded http-path value', () => {
      const addr = '/dns4/example.com/tcp/443/wss/http-path/dht%2Fnode-1';
      expect(() => multiaddr(addr)).not.toThrow();
      
      const ma = multiaddr(addr);
      expect(ma.toString()).toBe(addr);
    });

    it('should parse complex relay address with http-path', () => {
      // This is the exact format that was failing before
      const addr = '/dns4/imeyouwe.com/tcp/443/wss/http-path/libp2p/p2p/12D3KooWQ8bH8j5AmpgXgdjLFp1R37YeMfh65mvK3cPxENcSvPbR/p2p-circuit/p2p/12D3KooWH26HEwG9UHfXLmZMnegTiiW32HM9bNdQruZoTBRu4VYs';
      expect(() => multiaddr(addr)).not.toThrow();
      
      const ma = multiaddr(addr);
      expect(ma.toString()).toBe(addr);
    });

    it('should parse WebRTC over relay address with http-path', () => {
      const addr = '/dns4/imeyouwe.com/tcp/443/wss/http-path/libp2p/p2p/12D3KooWQ8bH8j5AmpgXgdjLFp1R37YeMfh65mvK3cPxENcSvPbR/p2p-circuit/webrtc/p2p/12D3KooWH26HEwG9UHfXLmZMnegTiiW32HM9bNdQruZoTBRu4VYs';
      expect(() => multiaddr(addr)).not.toThrow();
      
      const ma = multiaddr(addr);
      expect(ma.toString()).toBe(addr);
    });
  });
});
