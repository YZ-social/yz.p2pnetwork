import { test, expect } from '@playwright/test';

/**
 * Browser UI Tests for Full Node Page
 * 
 * Tests the full-node.html UI components and interactions
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 10.7, 12.3
 */

test.describe('Full Node UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/full-node.html');
  });

  test.describe('Page Structure', () => {
    test('should display the page title and header', async ({ page }) => {
      await expect(page).toHaveTitle('libp2p Full Browser Node');
      await expect(page.locator('h1')).toContainText('libp2p Full Browser Node');
    });

    test('should display mode toggle buttons', async ({ page }) => {
      // Requirements: 7.3 - Mode toggle between thin client and full node
      const thinClientBtn = page.locator('#thin-client-btn');
      const fullNodeBtn = page.locator('#full-node-btn');
      
      await expect(thinClientBtn).toBeVisible();
      await expect(fullNodeBtn).toBeVisible();
      await expect(fullNodeBtn).toHaveClass(/active/);
    });

    test('should navigate to thin client when clicking thin client button', async ({ page }) => {
      const thinClientBtn = page.locator('#thin-client-btn');
      await thinClientBtn.click();
      // The thin client button navigates to index.html, which may redirect to root
      await page.waitForURL(/index\.html|\/$/);
    });
  });

  test.describe('Status Bar - Requirements 7.1, 7.2', () => {
    test('should display connection status', async ({ page }) => {
      // Requirements: 7.1 - Display current peer ID and connection status
      const connectionStatus = page.locator('#connection-status');
      await expect(connectionStatus).toBeVisible();
      await expect(connectionStatus).toHaveText('Disconnected');
      await expect(connectionStatus).toHaveClass(/disconnected/);
    });

    test('should display peer ID placeholder', async ({ page }) => {
      // Requirements: 7.1 - Display current peer ID
      const peerId = page.locator('#peer-id');
      await expect(peerId).toBeVisible();
      await expect(peerId).toHaveText('-');
    });

    test('should display peer counts', async ({ page }) => {
      // Requirements: 7.2 - Show number of connected peers (browser and server)
      const browserPeerCount = page.locator('#browser-peer-count');
      const serverPeerCount = page.locator('#server-peer-count');
      const totalPeerCount = page.locator('#total-peer-count');
      
      await expect(browserPeerCount).toBeVisible();
      await expect(serverPeerCount).toBeVisible();
      await expect(totalPeerCount).toBeVisible();
      
      await expect(browserPeerCount).toHaveText('0');
      await expect(serverPeerCount).toHaveText('0');
      await expect(totalPeerCount).toHaveText('0');
    });

    test('should display peer ID mode', async ({ page }) => {
      const peerIdMode = page.locator('#peer-id-mode');
      await expect(peerIdMode).toBeVisible();
    });

    test('should display uptime', async ({ page }) => {
      const uptime = page.locator('#uptime');
      await expect(uptime).toBeVisible();
    });
  });

  test.describe('Connection Controls', () => {
    test('should have start and stop buttons', async ({ page }) => {
      const startBtn = page.locator('#start-btn');
      const stopBtn = page.locator('#stop-btn');
      
      await expect(startBtn).toBeVisible();
      await expect(stopBtn).toBeVisible();
      
      // Initially start should be enabled, stop should be disabled
      await expect(startBtn).toBeEnabled();
      await expect(stopBtn).toBeDisabled();
    });

    test('should display bootstrap server info', async ({ page }) => {
      const bootstrapInfo = page.locator('#bootstrap-info');
      await expect(bootstrapInfo).toBeVisible();
      await expect(bootstrapInfo).toContainText('imeyouwe.com');
    });
  });

  test.describe('Network Statistics - Requirements 7.2, 7.5', () => {
    test('should display network statistics card', async ({ page }) => {
      const statPeers = page.locator('#stat-peers');
      const statDataIn = page.locator('#stat-data-in');
      const statDataOut = page.locator('#stat-data-out');
      
      await expect(statPeers).toBeVisible();
      await expect(statDataIn).toBeVisible();
      await expect(statDataOut).toBeVisible();
      
      await expect(statPeers).toHaveText('0');
      await expect(statDataIn).toHaveText('0 B');
      await expect(statDataOut).toHaveText('0 B');
    });
  });

  test.describe('DHT Routing Table - Requirements 7.4', () => {
    test('should display DHT routing table statistics', async ({ page }) => {
      // Requirements: 7.4 - Display DHT routing table statistics
      const routingTableSize = page.locator('#routing-table-size');
      const routingBuckets = page.locator('#routing-buckets');
      const dhtQueries = page.locator('#dht-queries');
      const dhtResponses = page.locator('#dht-responses');
      
      await expect(routingTableSize).toBeVisible();
      await expect(routingBuckets).toBeVisible();
      await expect(dhtQueries).toBeVisible();
      await expect(dhtResponses).toBeVisible();
      
      await expect(routingTableSize).toHaveText('0');
      await expect(routingBuckets).toHaveText('0');
      await expect(dhtQueries).toHaveText('0');
      await expect(dhtResponses).toHaveText('0');
    });
  });

  test.describe('Relay Status - Requirements 10.7, 12.3', () => {
    test('should display relay status card', async ({ page }) => {
      // Requirements: 10.7 - Show current relay node
      const relayIndicator = page.locator('#relay-indicator');
      const currentRelay = page.locator('#current-relay');
      
      await expect(relayIndicator).toBeVisible();
      await expect(currentRelay).toBeVisible();
      await expect(currentRelay).toHaveText('Not using relay');
    });

    test('should display relay utilization', async ({ page }) => {
      // Requirements: 12.3 - Show relay utilization
      const relayUtilizationBar = page.locator('#relay-utilization-bar');
      const relayUtilizationText = page.locator('#relay-utilization-text');
      const relayCapacity = page.locator('#relay-capacity');
      
      // The bar element exists but may be hidden when width is 0%
      await expect(relayUtilizationBar).toBeAttached();
      await expect(relayUtilizationText).toBeVisible();
      await expect(relayCapacity).toBeVisible();
      
      await expect(relayUtilizationText).toHaveText('0%');
    });

    test('should display relay counts', async ({ page }) => {
      const knownRelays = page.locator('#known-relays');
      const availableRelays = page.locator('#available-relays');
      const relayMode = page.locator('#relay-mode');
      
      await expect(knownRelays).toBeVisible();
      await expect(availableRelays).toBeVisible();
      await expect(relayMode).toBeVisible();
      
      await expect(knownRelays).toHaveText('0');
      await expect(availableRelays).toHaveText('0');
      await expect(relayMode).toHaveText('Direct');
    });
  });

  test.describe('Bandwidth Usage - Requirements 7.5', () => {
    test('should display bandwidth usage card', async ({ page }) => {
      // Requirements: 7.5 - Show bandwidth usage (in/out)
      const bandwidthInBar = page.locator('#bandwidth-in-bar');
      const bandwidthInRate = page.locator('#bandwidth-in-rate');
      const bandwidthInTotal = page.locator('#bandwidth-in-total');
      const bandwidthOutBar = page.locator('#bandwidth-out-bar');
      const bandwidthOutRate = page.locator('#bandwidth-out-rate');
      const bandwidthOutTotal = page.locator('#bandwidth-out-total');
      
      // The bar elements exist but may be hidden when width is 0%
      await expect(bandwidthInBar).toBeAttached();
      await expect(bandwidthInRate).toBeVisible();
      await expect(bandwidthInTotal).toBeVisible();
      await expect(bandwidthOutBar).toBeAttached();
      await expect(bandwidthOutRate).toBeVisible();
      await expect(bandwidthOutTotal).toBeVisible();
      
      await expect(bandwidthInRate).toHaveText('0 B/s');
      await expect(bandwidthOutRate).toHaveText('0 B/s');
    });
  });

  test.describe('Connected Peers List', () => {
    test('should display connected peers list', async ({ page }) => {
      const connectedPeerList = page.locator('#connected-peer-list');
      await expect(connectedPeerList).toBeVisible();
      await expect(connectedPeerList).toContainText('No peers connected');
    });

    test('should display peer type legend', async ({ page }) => {
      // Check for browser and server peer type indicators
      const legend = page.locator('text=Browser (WebRTC)');
      await expect(legend).toBeVisible();
      
      const serverLegend = page.locator('text=Server (WebSocket)');
      await expect(serverLegend).toBeVisible();
    });
  });

  test.describe('DHT Operations', () => {
    test('should have DHT store form', async ({ page }) => {
      const storeKey = page.locator('#store-key');
      const storeValue = page.locator('#store-value');
      const storeBtn = page.locator('#store-btn');
      
      await expect(storeKey).toBeVisible();
      await expect(storeValue).toBeVisible();
      await expect(storeBtn).toBeVisible();
      
      // Should be disabled when not connected
      await expect(storeBtn).toBeDisabled();
    });

    test('should have DHT retrieve form', async ({ page }) => {
      const getKey = page.locator('#get-key');
      const getBtn = page.locator('#get-btn');
      
      await expect(getKey).toBeVisible();
      await expect(getBtn).toBeVisible();
      
      // Should be disabled when not connected
      await expect(getBtn).toBeDisabled();
    });
  });

  test.describe('Activity Log', () => {
    test('should display activity log', async ({ page }) => {
      const logOutput = page.locator('#log-output');
      await expect(logOutput).toBeVisible();
    });

    test('should have clear log button', async ({ page }) => {
      const clearLogBtn = page.locator('#clear-log');
      await expect(clearLogBtn).toBeVisible();
    });

    test('should show initial log messages', async ({ page }) => {
      const logOutput = page.locator('#log-output');
      await expect(logOutput).toContainText('Ready to start full browser node');
    });

    test('should clear log when clear button is clicked', async ({ page }) => {
      const logOutput = page.locator('#log-output');
      const clearLogBtn = page.locator('#clear-log');
      
      // Verify there's content first
      await expect(logOutput).not.toBeEmpty();
      
      // Click clear
      await clearLogBtn.click();
      
      // Log should be empty
      await expect(logOutput).toBeEmpty();
    });
  });
});

test.describe('Thin Client UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
  });

  test('should display the thin client page', async ({ page }) => {
    await expect(page).toHaveTitle('libp2p DHT Browser Client');
    await expect(page.locator('h1')).toContainText('libp2p Overlay Network');
  });

  test('should have connection controls', async ({ page }) => {
    const connectBtn = page.locator('#connect-btn');
    const disconnectBtn = page.locator('#disconnect-btn');
    
    await expect(connectBtn).toBeVisible();
    await expect(disconnectBtn).toBeVisible();
    await expect(connectBtn).toBeEnabled();
    await expect(disconnectBtn).toBeDisabled();
  });
});


test.describe('Full Node UI Interactions', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the server endpoints to allow testing without a real server
    await page.route('**/browser/config', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          peerIdMode: 'ephemeral',
          bootstrapPeers: [],
          relayNodes: [],
          maxConnections: 50,
          dhtEnabled: true,
          overlayEnabled: true
        })
      });
    });

    await page.route('**/relay/status', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          activeReservations: 10,
          maxReservations: 128,
          activeCircuits: 5,
          maxCircuits: 16
        })
      });
    });

    await page.goto('/full-node.html');
  });

  test.describe('Node Start/Stop', () => {
    test('should start node and update UI state', async ({ page }) => {
      const startBtn = page.locator('#start-btn');
      const stopBtn = page.locator('#stop-btn');
      const connectionStatus = page.locator('#connection-status');
      const logOutput = page.locator('#log-output');
      
      // Click start
      await startBtn.click();
      
      // Wait for connection status to change
      await expect(connectionStatus).toHaveText('Connected', { timeout: 10000 });
      await expect(connectionStatus).toHaveClass(/connected/);
      
      // Buttons should swap states
      await expect(startBtn).toBeDisabled();
      await expect(stopBtn).toBeEnabled();
      
      // Log should show startup messages
      await expect(logOutput).toContainText('Starting full browser node');
      await expect(logOutput).toContainText('Browser node started successfully');
    });

    test('should stop node and reset UI state', async ({ page }) => {
      const startBtn = page.locator('#start-btn');
      const stopBtn = page.locator('#stop-btn');
      const connectionStatus = page.locator('#connection-status');
      
      // Start first
      await startBtn.click();
      await expect(connectionStatus).toHaveText('Connected', { timeout: 10000 });
      
      // Then stop
      await stopBtn.click();
      
      // Wait for disconnection
      await expect(connectionStatus).toHaveText('Disconnected', { timeout: 5000 });
      await expect(connectionStatus).toHaveClass(/disconnected/);
      
      // Buttons should swap back
      await expect(startBtn).toBeEnabled();
      await expect(stopBtn).toBeDisabled();
    });

    test('should enable DHT operations after connecting', async ({ page }) => {
      const startBtn = page.locator('#start-btn');
      const storeBtn = page.locator('#store-btn');
      const getBtn = page.locator('#get-btn');
      
      // Initially disabled
      await expect(storeBtn).toBeDisabled();
      await expect(getBtn).toBeDisabled();
      
      // Start node
      await startBtn.click();
      await expect(page.locator('#connection-status')).toHaveText('Connected', { timeout: 10000 });
      
      // Should be enabled now
      await expect(storeBtn).toBeEnabled();
      await expect(getBtn).toBeEnabled();
    });
  });

  test.describe('DHT Operations', () => {
    test('should store value in DHT', async ({ page }) => {
      const startBtn = page.locator('#start-btn');
      const storeKey = page.locator('#store-key');
      const storeValue = page.locator('#store-value');
      const storeBtn = page.locator('#store-btn');
      const storeResult = page.locator('#store-result');
      const logOutput = page.locator('#log-output');
      
      // Start node first
      await startBtn.click();
      await expect(page.locator('#connection-status')).toHaveText('Connected', { timeout: 10000 });
      
      // Fill in store form
      await storeKey.fill('test-key');
      await storeValue.fill('test-value');
      
      // Click store
      await storeBtn.click();
      
      // Check log and result
      await expect(logOutput).toContainText('Storing value for key: test-key');
      await expect(storeResult).toBeVisible({ timeout: 5000 });
      await expect(storeResult).toContainText('Stored successfully');
    });

    test('should retrieve value from DHT', async ({ page }) => {
      const startBtn = page.locator('#start-btn');
      const getKey = page.locator('#get-key');
      const getBtn = page.locator('#get-btn');
      const getResult = page.locator('#get-result');
      const logOutput = page.locator('#log-output');
      
      // Start node first
      await startBtn.click();
      await expect(page.locator('#connection-status')).toHaveText('Connected', { timeout: 10000 });
      
      // Fill in get form
      await getKey.fill('test-key');
      
      // Click get
      await getBtn.click();
      
      // Check log and result
      await expect(logOutput).toContainText('Retrieving value for key: test-key');
      await expect(getResult).toBeVisible({ timeout: 5000 });
    });

    test('should update DHT query counter', async ({ page }) => {
      const startBtn = page.locator('#start-btn');
      const getKey = page.locator('#get-key');
      const getBtn = page.locator('#get-btn');
      const dhtQueries = page.locator('#dht-queries');
      
      // Start node first
      await startBtn.click();
      await expect(page.locator('#connection-status')).toHaveText('Connected', { timeout: 10000 });
      
      // Initial count
      await expect(dhtQueries).toHaveText('0');
      
      // Perform a query
      await getKey.fill('test-key');
      await getBtn.click();
      
      // Counter should increment
      await expect(dhtQueries).toHaveText('1', { timeout: 5000 });
    });
  });

  test.describe('Keyboard Shortcuts', () => {
    test('should submit store form on Enter key', async ({ page }) => {
      const startBtn = page.locator('#start-btn');
      const storeKey = page.locator('#store-key');
      const storeValue = page.locator('#store-value');
      const logOutput = page.locator('#log-output');
      
      // Start node first
      await startBtn.click();
      await expect(page.locator('#connection-status')).toHaveText('Connected', { timeout: 10000 });
      
      // Fill in store form
      await storeKey.fill('enter-test-key');
      await storeValue.fill('enter-test-value');
      
      // Press Enter in value field
      await storeValue.press('Enter');
      
      // Should trigger store
      await expect(logOutput).toContainText('Storing value for key: enter-test-key');
    });

    test('should submit get form on Enter key', async ({ page }) => {
      const startBtn = page.locator('#start-btn');
      const getKey = page.locator('#get-key');
      const logOutput = page.locator('#log-output');
      
      // Start node first
      await startBtn.click();
      await expect(page.locator('#connection-status')).toHaveText('Connected', { timeout: 10000 });
      
      // Fill in get form and press Enter
      await getKey.fill('enter-get-key');
      await getKey.press('Enter');
      
      // Should trigger get
      await expect(logOutput).toContainText('Retrieving value for key: enter-get-key');
    });
  });

  test.describe('Connected Peers Display', () => {
    test('should show connected peers after starting', async ({ page }) => {
      const startBtn = page.locator('#start-btn');
      const connectedPeerList = page.locator('#connected-peer-list');
      const browserPeerCount = page.locator('#browser-peer-count');
      const serverPeerCount = page.locator('#server-peer-count');
      
      // Start node
      await startBtn.click();
      await expect(page.locator('#connection-status')).toHaveText('Connected', { timeout: 10000 });
      
      // Should show simulated peers
      await expect(connectedPeerList).not.toContainText('No peers connected');
      
      // Peer counts should be updated
      const browserCount = await browserPeerCount.textContent();
      const serverCount = await serverPeerCount.textContent();
      expect(parseInt(browserCount || '0') + parseInt(serverCount || '0')).toBeGreaterThan(0);
    });
  });

  test.describe('Uptime Display', () => {
    test('should update uptime after starting', async ({ page }) => {
      const startBtn = page.locator('#start-btn');
      const uptime = page.locator('#uptime');
      
      // Initially shows placeholder
      await expect(uptime).toHaveText('-');
      
      // Start node
      await startBtn.click();
      await expect(page.locator('#connection-status')).toHaveText('Connected', { timeout: 10000 });
      
      // Wait a bit for uptime to update
      await page.waitForTimeout(1500);
      
      // Uptime should show a value
      const uptimeText = await uptime.textContent();
      expect(uptimeText).toMatch(/\d+s|\d+m/);
    });
  });
});
