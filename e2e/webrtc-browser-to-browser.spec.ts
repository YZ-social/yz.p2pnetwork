/**
 * E2E Test: WebRTC Browser-to-Browser Connectivity
 * 
 * This test verifies that two browser nodes can establish a direct WebRTC
 * connection using a relay server for SDP signaling.
 * 
 * The flow:
 * 1. Browser A connects to bootstrap/relay server
 * 2. Browser A gets a circuit relay reservation
 * 3. Browser A should have a WebRTC address like:
 *    /dns4/.../p2p/{relayPeerId}/p2p-circuit/webrtc/p2p/{browserAPeerId}
 * 4. Browser B connects to bootstrap/relay server
 * 5. Browser B discovers Browser A's WebRTC address
 * 6. Browser B dials Browser A's WebRTC address
 * 7. Direct WebRTC connection is established (relay only used for signaling)
 * 8. Browser B sends echo message to Browser A
 * 9. Browser A responds
 */

import { test, expect, type Page } from '@playwright/test';

// Test configuration
const BOOTSTRAP_URL = 'https://imeyouwe.com';
const FULL_NODE_URL = `${BOOTSTRAP_URL}/full-node.html`;
const CONNECTION_TIMEOUT = 30000;
const WEBRTC_TIMEOUT = 60000;

/**
 * Helper to wait for browser node to be connected
 */
async function waitForConnection(page: Page, minPeers: number = 1): Promise<void> {
  await page.waitForFunction(
    (min) => {
      const statusEl = document.getElementById('connection-status');
      const peersEl = document.getElementById('total-peer-count');
      if (!statusEl || !peersEl) return false;
      const status = statusEl.textContent || '';
      const peers = parseInt(peersEl.textContent || '0', 10);
      return status.includes('Connected') && peers >= min;
    },
    minPeers,
    { timeout: CONNECTION_TIMEOUT }
  );
}

/**
 * Helper to get the browser's peer ID
 */
async function getPeerId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.getElementById('peer-id');
    return el?.textContent || '';
  });
}

/**
 * Helper to get the browser's multiaddrs
 */
async function getMultiaddrs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // Get addresses from the browserNode object exposed on window
    const browserNode = (window as any).browserNode;
    if (!browserNode) {
      console.log('[Test] browserNode not found on window');
      return [];
    }
    
    // Check if node is started by checking state
    const state = browserNode.getState?.();
    if (!state || state.status !== 'connected') {
      console.log('[Test] browserNode not connected, status:', state?.status);
      return [];
    }
    
    try {
      // Access libp2p directly from the private field since getLibp2pNode throws if not started
      const libp2p = (browserNode as any).libp2p;
      if (!libp2p) {
        console.log('[Test] libp2p not available');
        return [];
      }
      
      const addrs = libp2p.getMultiaddrs();
      console.log('[Test] getMultiaddrs returned:', addrs.length, 'addresses');
      return addrs.map((a: any) => a.toString());
    } catch (e) {
      console.error('[Test] Error getting multiaddrs:', e);
      return [];
    }
  });
}

/**
 * Helper to check if browser has WebRTC address
 */
async function hasWebRTCAddress(page: Page): Promise<boolean> {
  const addrs = await getMultiaddrs(page);
  return addrs.some(a => a.includes('/webrtc/'));
}

/**
 * Helper to check if browser has circuit relay address
 */
async function hasRelayAddress(page: Page): Promise<boolean> {
  const addrs = await getMultiaddrs(page);
  return addrs.some(a => a.includes('/p2p-circuit'));
}

/**
 * Helper to get WebRTC address for a browser
 */
async function getWebRTCAddress(page: Page): Promise<string | null> {
  const addrs = await getMultiaddrs(page);
  return addrs.find(a => a.includes('/webrtc/')) || null;
}

/**
 * Helper to get circuit relay address for a browser
 */
async function getRelayAddress(page: Page): Promise<string | null> {
  const addrs = await getMultiaddrs(page);
  return addrs.find(a => a.includes('/p2p-circuit') && !a.includes('/webrtc/')) || null;
}

test.describe('WebRTC Browser-to-Browser Connectivity', () => {
  
  test('Browser A gets WebRTC address after relay reservation', async ({ page }) => {
    // Navigate to full node page
    await page.goto(FULL_NODE_URL);
    
    // Start the browser node
    await page.click('#start-btn');
    
    // Wait for connection
    await waitForConnection(page);
    
    // Wait for overlay to be ready (indicates node is fully started)
    await page.waitForFunction(
      () => {
        const overlayEl = document.getElementById('overlay-status');
        return overlayEl?.textContent === 'Ready';
      },
      { timeout: 30000 }
    );
    
    // Debug: Log all addresses immediately after connection
    const initialAddrs = await getMultiaddrs(page);
    console.log('Initial addresses after connection:', initialAddrs.length);
    for (const addr of initialAddrs) {
      console.log('  ', addr);
    }
    
    // Wait a bit for relay reservation to complete
    await page.waitForTimeout(5000);
    
    // Debug: Log addresses after waiting
    const addrsAfterWait = await getMultiaddrs(page);
    console.log('Addresses after 5s wait:', addrsAfterWait.length);
    for (const addr of addrsAfterWait) {
      console.log('  ', addr);
    }
    
    // Check for relay address first
    const hasRelay = await hasRelayAddress(page);
    console.log('Has relay address:', hasRelay);
    expect(hasRelay).toBe(true);
    
    // Wait for WebRTC address (may take a moment after relay reservation)
    let hasWebRTC = false;
    for (let i = 0; i < 10; i++) {
      hasWebRTC = await hasWebRTCAddress(page);
      if (hasWebRTC) break;
      await page.waitForTimeout(1000);
    }
    
    console.log('Has WebRTC address:', hasWebRTC);
    
    // Log all addresses for debugging
    const addrs = await getMultiaddrs(page);
    console.log('Browser addresses:');
    for (const addr of addrs) {
      console.log('  ', addr);
    }
    
    // This is the key assertion - browsers MUST have WebRTC addresses
    // for browser-to-browser connectivity to work
    expect(hasWebRTC).toBe(true);
  });

  test('Two browsers can discover each other', async ({ browser }) => {
    // Create two browser contexts (simulating two different browsers)
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    
    try {
      // Start Browser A
      console.log('Starting Browser A...');
      await pageA.goto(FULL_NODE_URL);
      await pageA.click('#start-btn');
      await waitForConnection(pageA);
      
      const peerIdA = await getPeerId(pageA);
      console.log('Browser A peer ID:', peerIdA);
      
      // Wait for Browser A to get addresses
      await pageA.waitForTimeout(3000);
      const addrsA = await getMultiaddrs(pageA);
      console.log('Browser A addresses:', addrsA);
      
      // Start Browser B
      console.log('Starting Browser B...');
      await pageB.goto(FULL_NODE_URL);
      await pageB.click('#start-btn');
      await waitForConnection(pageB);
      
      const peerIdB = await getPeerId(pageB);
      console.log('Browser B peer ID:', peerIdB);
      
      // Wait for Browser B to get addresses
      await pageB.waitForTimeout(3000);
      const addrsB = await getMultiaddrs(pageB);
      console.log('Browser B addresses:', addrsB);
      
      // Check that both browsers have relay addresses
      expect(addrsA.some(a => a.includes('/p2p-circuit'))).toBe(true);
      expect(addrsB.some(a => a.includes('/p2p-circuit'))).toBe(true);
      
      // Wait for peer discovery to find each other
      // Browser A should discover Browser B and vice versa
      console.log('Waiting for browsers to discover each other...');
      
      // Check Browser A's connected peers for Browser B
      let browserAFoundB = false;
      let browserBFoundA = false;
      
      for (let i = 0; i < 30; i++) {
        // Check if Browser A is connected to Browser B
        const connectedToB = await pageA.evaluate((targetPeerId) => {
          // @ts-ignore - accessing global browserNode
          const node = window.browserNode;
          if (!node || !node.libp2p) return false;
          const connections = node.libp2p.getConnections();
          return connections.some((c: any) => c.remotePeer.toString() === targetPeerId);
        }, peerIdB);
        
        // Check if Browser B is connected to Browser A
        const connectedToA = await pageB.evaluate((targetPeerId) => {
          // @ts-ignore - accessing global browserNode
          const node = window.browserNode;
          if (!node || !node.libp2p) return false;
          const connections = node.libp2p.getConnections();
          return connections.some((c: any) => c.remotePeer.toString() === targetPeerId);
        }, peerIdA);
        
        if (connectedToB) browserAFoundB = true;
        if (connectedToA) browserBFoundA = true;
        
        if (browserAFoundB || browserBFoundA) {
          console.log(`Discovery success! A->B: ${browserAFoundB}, B->A: ${browserBFoundA}`);
          break;
        }
        
        await pageA.waitForTimeout(2000);
      }
      
      // At least one browser should have discovered the other
      expect(browserAFoundB || browserBFoundA).toBe(true);
      
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('Browser-to-browser echo via WebRTC', async ({ browser }) => {
    // Create two browser contexts
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    
    try {
      // Start both browsers
      console.log('Starting Browser A...');
      await pageA.goto(FULL_NODE_URL);
      await pageA.click('#start-btn');
      await waitForConnection(pageA);
      
      const peerIdA = await getPeerId(pageA);
      console.log('Browser A peer ID:', peerIdA);
      
      console.log('Starting Browser B...');
      await pageB.goto(FULL_NODE_URL);
      await pageB.click('#start-btn');
      await waitForConnection(pageB);
      
      const peerIdB = await getPeerId(pageB);
      console.log('Browser B peer ID:', peerIdB);
      
      // Wait for addresses to be established
      await pageA.waitForTimeout(5000);
      await pageB.waitForTimeout(5000);
      
      // Get Browser A's relay address
      const relayAddrA = await getRelayAddress(pageA);
      console.log('Browser A relay address:', relayAddrA);
      expect(relayAddrA).not.toBeNull();
      
      // Construct WebRTC address for Browser A
      // Convert: .../p2p-circuit/p2p/{peerIdA} -> .../p2p-circuit/webrtc/p2p/{peerIdA}
      const webrtcAddrA = relayAddrA!.replace(
        /\/p2p-circuit\/p2p\/([^/]+)$/,
        '/p2p-circuit/webrtc/p2p/$1'
      );
      console.log('Browser A WebRTC address:', webrtcAddrA);
      
      // Browser B dials Browser A via WebRTC
      console.log('Browser B dialing Browser A via WebRTC...');
      const dialResult = await pageB.evaluate(async (targetAddr) => {
        try {
          // @ts-ignore - accessing global browserNode
          const node = window.browserNode;
          if (!node || !node.libp2p) {
            return { success: false, error: 'Node not available' };
          }
          
          // @ts-ignore - multiaddr is available globally
          const ma = window.multiaddr(targetAddr);
          await node.libp2p.dial(ma, { signal: AbortSignal.timeout(30000) });
          
          return { success: true };
        } catch (err: any) {
          return { success: false, error: err.message || String(err) };
        }
      }, webrtcAddrA);
      
      console.log('Dial result:', dialResult);
      
      if (!dialResult.success) {
        console.log('WebRTC dial failed, checking connection type...');
        
        // Check what type of connection was established (if any)
        const connectionInfo = await pageB.evaluate((targetPeerId) => {
          // @ts-ignore
          const node = window.browserNode;
          if (!node || !node.libp2p) return null;
          
          const connections = node.libp2p.getConnections();
          const conn = connections.find((c: any) => c.remotePeer.toString() === targetPeerId);
          if (!conn) return null;
          
          return {
            remoteAddr: conn.remoteAddr.toString(),
            isWebRTC: conn.remoteAddr.toString().includes('/webrtc/'),
            isRelay: conn.remoteAddr.toString().includes('/p2p-circuit'),
          };
        }, peerIdA);
        
        console.log('Connection info:', connectionInfo);
      }
      
      // Verify connection exists
      const isConnected = await pageB.evaluate((targetPeerId) => {
        // @ts-ignore
        const node = window.browserNode;
        if (!node || !node.libp2p) return false;
        const connections = node.libp2p.getConnections();
        return connections.some((c: any) => c.remotePeer.toString() === targetPeerId);
      }, peerIdA);
      
      expect(isConnected).toBe(true);
      
      // Now test echo - Browser B sends message to Browser A
      console.log('Testing echo from Browser B to Browser A...');
      
      // Set target peer ID in Browser B's input
      await pageB.fill('#target-peer-id', peerIdA);
      await pageB.fill('#echo-message', 'Hello from Browser B!');
      await pageB.click('#send-echo-btn');
      
      // Wait for response
      await pageB.waitForTimeout(5000);
      
      // Check echo result
      const echoResult = await pageB.evaluate(() => {
        const el = document.getElementById('echo-result');
        return el?.textContent || '';
      });
      
      console.log('Echo result:', echoResult);
      expect(echoResult).toContain('Hello from Browser B!');
      
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test('Verify WebRTC connection type (not just relay)', async ({ browser }) => {
    // This test specifically verifies that the connection is WebRTC, not just circuit relay
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    
    try {
      // Start both browsers
      await pageA.goto(FULL_NODE_URL);
      await pageA.click('#start-btn');
      await waitForConnection(pageA);
      
      await pageB.goto(FULL_NODE_URL);
      await pageB.click('#start-btn');
      await waitForConnection(pageB);
      
      const peerIdA = await getPeerId(pageA);
      const peerIdB = await getPeerId(pageB);
      
      // Wait for discovery
      await pageA.waitForTimeout(10000);
      
      // Check connection type from Browser B to Browser A
      const connectionTypes = await pageB.evaluate((targetPeerId) => {
        // @ts-ignore
        const node = window.browserNode;
        if (!node || !node.libp2p) return [];
        
        const connections = node.libp2p.getConnections();
        return connections
          .filter((c: any) => c.remotePeer.toString() === targetPeerId)
          .map((c: any) => ({
            remoteAddr: c.remoteAddr.toString(),
            isWebRTC: c.remoteAddr.toString().includes('/webrtc/'),
            isRelay: c.remoteAddr.toString().includes('/p2p-circuit') && !c.remoteAddr.toString().includes('/webrtc/'),
          }));
      }, peerIdA);
      
      console.log('Connection types from B to A:', connectionTypes);
      
      // We want at least one WebRTC connection for true browser-to-browser
      const hasWebRTCConnection = connectionTypes.some((c: any) => c.isWebRTC);
      const hasRelayOnlyConnection = connectionTypes.some((c: any) => c.isRelay && !c.isWebRTC);
      
      console.log('Has WebRTC connection:', hasWebRTCConnection);
      console.log('Has relay-only connection:', hasRelayOnlyConnection);
      
      // For a proper browser mesh network, we need WebRTC connections
      // Relay-only connections won't scale to 1000s of browsers
      if (!hasWebRTCConnection && hasRelayOnlyConnection) {
        console.warn('WARNING: Only relay connections established, no WebRTC!');
        console.warn('This means browser-to-browser traffic goes through the relay server.');
        console.warn('For a scalable mesh network, WebRTC connections are required.');
      }
      
      // This assertion may fail initially - that's the bug we're trying to fix
      expect(hasWebRTCConnection).toBe(true);
      
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
