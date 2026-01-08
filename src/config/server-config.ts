/**
 * Multi-server DHT configuration module
 * 
 * Provides utilities for calculating global node indices and generating
 * public addresses for nodes across multiple servers.
 * 
 * @module config/server-config
 */

/** Default number of nodes per server */
export const DEFAULT_NODES_PER_SERVER = 15;

/** Default number of servers in the cluster */
export const DEFAULT_SERVER_COUNT = 4;

/** Server configuration for multi-server DHT deployment */
export interface ServerConfig {
  /** Server index (1-4) */
  serverIndex: number;
  /** External hostname for this server (e.g., "imeyouwe.com" or "node2.imeyouwe.com") */
  externalHost: string;
  /** Number of nodes running on this server */
  nodesPerServer: number;
  /** Calculated offset for global index: (serverIndex - 1) * nodesPerServer */
  globalIndexOffset: number;
  /** Bootstrap addresses for cross-server connectivity */
  bootstrapAddresses: string[];
}

/** Node configuration within a server */
export interface NodeConfig {
  /** Local index within the server (1-15) */
  localIndex: number;
  /** Global index across all servers (1-60) */
  globalIndex: number;
  /** Public path for nginx routing (e.g., "/dht/node-1") */
  publicPath: string;
  /** Full announce address for libp2p */
  announceAddress: string;
}

/**
 * Calculate the global node index from server index and local index.
 * 
 * Formula: globalIndex = (serverIndex - 1) * nodesPerServer + localIndex
 * 
 * @param serverIndex - Server index (1-4)
 * @param localIndex - Local node index within server (1-15)
 * @param nodesPerServer - Number of nodes per server (default: 15)
 * @returns Global node index (1-60 for 4 servers with 15 nodes each)
 * @throws Error if serverIndex or localIndex is out of valid range
 */
export function calculateGlobalIndex(
  serverIndex: number,
  localIndex: number,
  nodesPerServer: number = DEFAULT_NODES_PER_SERVER
): number {
  if (serverIndex < 1 || serverIndex > DEFAULT_SERVER_COUNT) {
    throw new Error(`Invalid server index: ${serverIndex}. Must be between 1 and ${DEFAULT_SERVER_COUNT}`);
  }
  if (localIndex < 1 || localIndex > nodesPerServer) {
    throw new Error(`Invalid local index: ${localIndex}. Must be between 1 and ${nodesPerServer}`);
  }
  return (serverIndex - 1) * nodesPerServer + localIndex;
}

/**
 * Get the public path for a node based on its global index.
 * 
 * @param globalIndex - Global node index (1-60)
 * @returns Public path string (e.g., "/dht/node-1")
 */
export function getPublicPath(globalIndex: number): string {
  return `/dht/node-${globalIndex}`;
}

/**
 * Get the full announce address for a node.
 * 
 * @param host - External hostname (e.g., "imeyouwe.com")
 * @param globalIndex - Global node index (1-60)
 * @returns Full multiaddr-style announce address
 */
export function getAnnounceAddress(host: string, globalIndex: number): string {
  const publicPath = getPublicPath(globalIndex);
  return `/dns4/${host}/tcp/443/wss${publicPath}`;
}

/**
 * Get the external hostname for a given server index.
 * 
 * @param serverIndex - Server index (1-4)
 * @param baseDomain - Base domain (default: "imeyouwe.com")
 * @returns External hostname for the server
 */
export function getExternalHost(serverIndex: number, baseDomain: string = 'imeyouwe.com'): string {
  if (serverIndex === 1) {
    return baseDomain;
  }
  return `node${serverIndex}.${baseDomain}`;
}

/**
 * Get the default cross-server bootstrap addresses.
 * 
 * @param baseDomain - Base domain (default: "imeyouwe.com")
 * @returns Array of bootstrap addresses for all servers
 */
export function getCrossServerBootstraps(baseDomain: string = 'imeyouwe.com'): string[] {
  return [
    `wss://${baseDomain}/ws`,
    `wss://node2.${baseDomain}/ws`,
    `wss://node3.${baseDomain}/ws`,
    `wss://node4.${baseDomain}/ws`,
  ];
}

/**
 * Create a full server configuration.
 * 
 * @param serverIndex - Server index (1-4)
 * @param options - Optional configuration overrides
 * @returns Complete ServerConfig object
 */
export function createServerConfig(
  serverIndex: number,
  options: {
    baseDomain?: string;
    nodesPerServer?: number;
  } = {}
): ServerConfig {
  const baseDomain = options.baseDomain ?? 'imeyouwe.com';
  const nodesPerServer = options.nodesPerServer ?? DEFAULT_NODES_PER_SERVER;

  return {
    serverIndex,
    externalHost: getExternalHost(serverIndex, baseDomain),
    nodesPerServer,
    globalIndexOffset: (serverIndex - 1) * nodesPerServer,
    bootstrapAddresses: getCrossServerBootstraps(baseDomain),
  };
}

/**
 * Create a full node configuration.
 * 
 * @param serverConfig - Server configuration
 * @param localIndex - Local node index within server (1-15)
 * @returns Complete NodeConfig object
 */
export function createNodeConfig(serverConfig: ServerConfig, localIndex: number): NodeConfig {
  const globalIndex = calculateGlobalIndex(
    serverConfig.serverIndex,
    localIndex,
    serverConfig.nodesPerServer
  );

  return {
    localIndex,
    globalIndex,
    publicPath: getPublicPath(globalIndex),
    announceAddress: getAnnounceAddress(serverConfig.externalHost, globalIndex),
  };
}
