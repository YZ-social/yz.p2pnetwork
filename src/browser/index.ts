/**
 * Browser module entry point
 * 
 * Exports all browser-specific functionality for bundling
 */

export { BrowserNode, createBrowserNodeFromConfig, fetchBrowserConfig, BrowserDHTAdapter } from './browser-node.js';
export type { StateChangeCallback, MessageHandler, MessageContext, PeerInfo } from './browser-node.js';

export { PeerIdManager } from './peer-id-manager.js';
export { ActivityMonitor } from './activity-monitor.js';
export { RelaySelector } from './relay-selector.js';
export { ConnectionUpgrader } from './connection-upgrader.js';
export { BrowserStorage } from './storage.js';
export { DEFAULT_ICE_SERVERS, createBrowserTransports, DEFAULT_TRANSPORT_CONFIG } from './transport-config.js';

export type {
  BrowserNodeConfig,
  BrowserNodeState,
  RelayNodeInfo,
  RelayStatus,
  BrowserConfigResponse,
  ActivityMonitorConfig,
  PeerIdManagerConfig,
  StoredIdentity,
  StoredPeer,
  StoredDHTRecord,
} from './types.js';

export { DEFAULT_BROWSER_NODE_CONFIG, DEFAULT_ACTIVITY_MONITOR_CONFIG } from './types.js';
