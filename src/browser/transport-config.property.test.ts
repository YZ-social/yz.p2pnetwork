/**
 * Property-based tests for Transport Configuration
 * 
 * Feature: browser-libp2p-nodes
 * Property 2: Connection Strategy Ordering
 * 
 * Tests that direct WebRTC connections are attempted before circuit relay
 * connections, ensuring optimal connection strategy.
 * 
 * **Validates: Requirements 2.3, 2.4**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import {
  ConnectionStrategyTracker,
  sortMultiaddrsByPriority,
  getTransportType,
  filterBrowserCompatibleAddrs,
  createStrategyEnforcingDialer,
  createBrowserTransports,
  DEFAULT_TRANSPORT_CONFIG,
  type BrowserTransportConfig,
} from './transport-config.js';

/**
 * Arbitrary for generating valid peer IDs
 */
const peerIdArbitrary = fc.stringMatching(/^12D3KooW[a-zA-Z0-9]{44}$/);

/**
 * Arbitrary for generating WebRTC multiaddrs
 */
const webrtcMultiaddrArbitrary = fc.tuple(
  fc.ipV4(),
  fc.integer({ min: 1024, max: 65535 }),
  peerIdArbitrary
).map(([ip, port, peerId]) => `/ip4/${ip}/udp/${port}/webrtc/p2p/${peerId}`);

/**
 * Arbitrary for generating WebSocket multiaddrs
 */
const websocketMultiaddrArbitrary = fc.tuple(
  fc.ipV4(),
  fc.integer({ min: 1024, max: 65535 }),
  peerIdArbitrary
).map(([ip, port, peerId]) => `/ip4/${ip}/tcp/${port}/ws/p2p/${peerId}`);

/**
 * Arbitrary for generating circuit relay multiaddrs
 */
const relayMultiaddrArbitrary = fc.tuple(
  fc.ipV4(),
  fc.integer({ min: 1024, max: 65535 }),
  peerIdArbitrary,
  peerIdArbitrary
).map(([ip, port, relayPeerId, targetPeerId]) => 
  `/ip4/${ip}/tcp/${port}/ws/p2p/${relayPeerId}/p2p-circuit/p2p/${targetPeerId}`
);

/**
 * Arbitrary for generating TCP-only multiaddrs (not browser compatible)
 */
const tcpOnlyMultiaddrArbitrary = fc.tuple(
  fc.ipV4(),
  fc.integer({ min: 1024, max: 65535 }),
  peerIdArbitrary
).map(([ip, port, peerId]) => `/ip4/${ip}/tcp/${port}/p2p/${peerId}`);

/**
 * Arbitrary for generating mixed multiaddr arrays
 */
const mixedMultiaddrsArbitrary = fc.tuple(
  fc.array(webrtcMultiaddrArbitrary, { minLength: 0, maxLength: 3 }),
  fc.array(websocketMultiaddrArbitrary, { minLength: 0, maxLength: 3 }),
  fc.array(relayMultiaddrArbitrary, { minLength: 0, maxLength: 3 })
).map(([webrtc, ws, relay]) => [...webrtc, ...ws, ...relay]);

/**
 * Arbitrary for transport config
 */
const transportConfigArbitrary: fc.Arbitrary<Partial<BrowserTransportConfig>> = fc.record({
  enableWebSocket: fc.boolean(),
  enableWebRTC: fc.boolean(),
  enableCircuitRelay: fc.boolean(),
});

/**
 * Feature: browser-libp2p-nodes, Property 2: Connection Strategy Ordering
 * 
 * For any browser node attempting to connect to another browser node,
 * the node SHALL attempt direct WebRTC connection first, and only fall
 * back to circuit relay after direct connection fails.
 * 
 * **Validates: Requirements 2.3, 2.4**
 */
describe('Property 2: Connection Strategy Ordering', () => {
  let tracker: ConnectionStrategyTracker;

  beforeEach(() => {
    tracker = new ConnectionStrategyTracker();
  });

  /**
   * Test that multiaddrs are sorted with direct connections before relay
   * 
   * For any array of multiaddrs containing both direct (WebRTC/WebSocket)
   * and relay addresses, sorting should place direct addresses first.
   */
  it('sortMultiaddrsByPriority places direct connections before relay', async () => {
    await fc.assert(
      fc.asyncProperty(
        mixedMultiaddrsArbitrary,
        async (multiaddrs) => {
          // Skip empty arrays
          if (multiaddrs.length === 0) return;

          const sorted = sortMultiaddrsByPriority(multiaddrs);

          // Find the index of first relay address in sorted array
          const firstRelayIndex = sorted.findIndex(
            addr => getTransportType(addr) === 'relay'
          );

          // If there's a relay address, all direct addresses should come before it
          if (firstRelayIndex !== -1) {
            const directAddrsAfterRelay = sorted
              .slice(firstRelayIndex)
              .filter(addr => {
                const type = getTransportType(addr);
                return type === 'webrtc' || type === 'websocket';
              });

            expect(directAddrsAfterRelay.length).toBe(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that WebRTC addresses come before WebSocket addresses
   * 
   * For any array of multiaddrs, WebRTC (direct browser-to-browser)
   * should be prioritized over WebSocket (server connections).
   */
  it('sortMultiaddrsByPriority places WebRTC before WebSocket', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(
          fc.array(webrtcMultiaddrArbitrary, { minLength: 1, maxLength: 3 }),
          fc.array(websocketMultiaddrArbitrary, { minLength: 1, maxLength: 3 })
        ),
        async ([webrtcAddrs, wsAddrs]) => {
          const mixed = [...wsAddrs, ...webrtcAddrs]; // Put WS first intentionally
          const sorted = sortMultiaddrsByPriority(mixed);

          // Find first WebSocket index
          const firstWsIndex = sorted.findIndex(
            addr => getTransportType(addr) === 'websocket'
          );

          // All WebRTC addresses should come before first WebSocket
          if (firstWsIndex !== -1) {
            const webrtcAfterWs = sorted
              .slice(firstWsIndex)
              .filter(addr => getTransportType(addr) === 'webrtc');

            expect(webrtcAfterWs.length).toBe(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that connection strategy tracker correctly identifies
   * when direct was attempted before relay
   */
  it('tracker correctly identifies direct-before-relay attempts', async () => {
    await fc.assert(
      fc.asyncProperty(
        peerIdArbitrary,
        fc.array(fc.constantFrom('webrtc', 'websocket', 'relay') as fc.Arbitrary<'webrtc' | 'websocket' | 'relay'>, { minLength: 1, maxLength: 10 }),
        async (peerId, transportSequence) => {
          tracker.clear();

          // Record attempts in sequence
          for (const transport of transportSequence) {
            tracker.recordAttempt({
              peerId,
              transport,
              success: false,
            });
          }

          const wasDirectFirst = tracker.wasDirectAttemptedBeforeRelay(peerId);

          // Calculate expected result
          const firstRelayIndex = transportSequence.indexOf('relay');
          const hasRelay = firstRelayIndex !== -1;

          if (!hasRelay) {
            // No relay attempt, so condition is satisfied
            expect(wasDirectFirst).toBe(true);
          } else {
            // Check if any direct attempt came before first relay
            const directBeforeRelay = transportSequence
              .slice(0, firstRelayIndex)
              .some(t => t === 'webrtc' || t === 'websocket');

            expect(wasDirectFirst).toBe(directBeforeRelay);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that strategy-enforcing dialer prepares multiaddrs correctly
   */
  it('strategy-enforcing dialer sorts multiaddrs with direct first', async () => {
    await fc.assert(
      fc.asyncProperty(
        peerIdArbitrary,
        mixedMultiaddrsArbitrary,
        async (peerId, multiaddrs) => {
          if (multiaddrs.length === 0) return;

          const dialer = createStrategyEnforcingDialer(tracker);
          const prepared = dialer.prepareForDial(peerId, multiaddrs);

          // Verify direct addresses come before relay
          const firstRelayIndex = prepared.findIndex(
            addr => getTransportType(addr) === 'relay'
          );

          if (firstRelayIndex !== -1) {
            const directAfterRelay = prepared
              .slice(firstRelayIndex)
              .filter(addr => {
                const type = getTransportType(addr);
                return type === 'webrtc' || type === 'websocket';
              });

            expect(directAfterRelay.length).toBe(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that TCP-only addresses are filtered out for browser compatibility
   */
  it('filterBrowserCompatibleAddrs removes TCP-only addresses', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(
          fc.array(tcpOnlyMultiaddrArbitrary, { minLength: 1, maxLength: 3 }),
          fc.array(websocketMultiaddrArbitrary, { minLength: 0, maxLength: 3 }),
          fc.array(webrtcMultiaddrArbitrary, { minLength: 0, maxLength: 3 })
        ),
        async ([tcpAddrs, wsAddrs, webrtcAddrs]) => {
          const mixed = [...tcpAddrs, ...wsAddrs, ...webrtcAddrs];
          const filtered = filterBrowserCompatibleAddrs(mixed);

          // No TCP-only addresses should remain
          const hasTcpOnly = filtered.some(addr => {
            return addr.includes('/tcp/') && 
                   !addr.includes('/ws/') && 
                   !addr.includes('/wss/');
          });

          expect(hasTcpOnly).toBe(false);

          // All WebSocket and WebRTC addresses should be preserved
          const wsCount = filtered.filter(addr => 
            addr.includes('/ws/') || addr.includes('/wss/')
          ).length;
          const webrtcCount = filtered.filter(addr => 
            addr.includes('/webrtc/')
          ).length;

          expect(wsCount).toBe(wsAddrs.length);
          expect(webrtcCount).toBe(webrtcAddrs.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that getTransportType correctly identifies transport types
   */
  it('getTransportType correctly identifies all transport types', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          webrtcMultiaddrArbitrary.map(addr => ({ addr, expected: 'webrtc' as const })),
          websocketMultiaddrArbitrary.map(addr => ({ addr, expected: 'websocket' as const })),
          relayMultiaddrArbitrary.map(addr => ({ addr, expected: 'relay' as const }))
        ),
        async ({ addr, expected }) => {
          const type = getTransportType(addr);
          expect(type).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that createBrowserTransports returns correct number of transports
   */
  it('createBrowserTransports returns transports based on config', async () => {
    await fc.assert(
      fc.asyncProperty(
        transportConfigArbitrary,
        async (config) => {
          const transports = createBrowserTransports(config);

          let expectedCount = 0;
          if (config.enableWebSocket ?? DEFAULT_TRANSPORT_CONFIG.enableWebSocket) {
            expectedCount++;
          }
          if (config.enableWebRTC ?? DEFAULT_TRANSPORT_CONFIG.enableWebRTC) {
            expectedCount++;
          }
          if (config.enableCircuitRelay ?? DEFAULT_TRANSPORT_CONFIG.enableCircuitRelay) {
            expectedCount++;
          }

          expect(transports.length).toBe(expectedCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Test that sorting is stable (preserves relative order within same priority)
   */
  it('sortMultiaddrsByPriority is stable within same transport type', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(webrtcMultiaddrArbitrary, { minLength: 2, maxLength: 5 }),
        async (webrtcAddrs) => {
          const sorted = sortMultiaddrsByPriority(webrtcAddrs);

          // All addresses should be preserved
          expect(sorted.length).toBe(webrtcAddrs.length);

          // Original relative order should be maintained
          for (let i = 0; i < webrtcAddrs.length; i++) {
            for (let j = i + 1; j < webrtcAddrs.length; j++) {
              const origIndexI = webrtcAddrs.indexOf(sorted[i]);
              const origIndexJ = webrtcAddrs.indexOf(sorted[j]);
              
              // If both are same type, relative order should be preserved
              if (getTransportType(sorted[i]) === getTransportType(sorted[j])) {
                expect(origIndexI).toBeLessThan(origIndexJ);
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
