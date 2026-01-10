/**
 * Address utility functions for public address advertisement
 * 
 * Provides utilities for building, validating, and filtering multiaddr addresses
 * to ensure all nodes advertise public nginx addresses instead of internal Docker addresses.
 * 
 * @module config/address-utils
 */

/** Configuration for node address validation */
export interface NodeAddressConfig {
  /** Internal listen addresses (for Docker network) */
  listenAddresses: string[];
  /** Public announce addresses (for DHT advertisement) */
  announceAddresses: string[];
  /** External hostname (e.g., "imeyouwe.com") */
  externalHost: string;
  /** Public path for nginx routing (e.g., "/dht/node-1") */
  publicPath: string;
}

/** Result of address validation */
export interface AddressValidationResult {
  isValid: boolean;
  hasPublicAddress: boolean;
  hasInternalAddress: boolean;
  warnings: string[];
}

/** Private IPv4 address patterns */
const PRIVATE_IP_PATTERNS = [
  /\/ip4\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}/,      // 10.0.0.0/8
  /\/ip4\/172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}/, // 172.16.0.0/12
  /\/ip4\/192\.168\.\d{1,3}\.\d{1,3}/,         // 192.168.0.0/16
  /\/ip4\/127\.\d{1,3}\.\d{1,3}\.\d{1,3}/,     // 127.0.0.0/8 (loopback)
];

/** Localhost patterns */
const LOCALHOST_PATTERNS = [
  /\/dns4\/localhost\//,
  /\/dns\/localhost\//,
  /\/ip4\/127\.0\.0\.1/,
];

/** Docker internal DNS patterns */
const DOCKER_INTERNAL_PATTERNS = [
  /\/dns4\/libp2p-bootstrap\//,
  /\/dns4\/dht-node-\d+\//,
  /\/dns\/libp2p-bootstrap\//,
  /\/dns\/dht-node-\d+\//,
];

/**
 * Build an announce address for nginx path-based routing.
 * 
 * The address format is: /dns4/{host}/tcp/443/wss/http-path/{url-encoded-path}
 * 
 * Note: Do NOT include /p2p/{peerId} - libp2p appends it automatically.
 * 
 * @param host - External hostname (e.g., "imeyouwe.com")
 * @param path - Public path for nginx routing (e.g., "/dht/node-1" or "libp2p")
 * @returns Multiaddr string for announce address
 */
export function buildAnnounceAddress(host: string, path: string): string {
  // Remove leading slash if present for consistent handling
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  // URL-encode the path (/ becomes %2F)
  const encodedPath = encodeURIComponent(cleanPath);
  return `/dns4/${host}/tcp/443/wss/http-path/${encodedPath}`;
}

/**
 * Check if an address contains a private IP range.
 * 
 * @param addr - Multiaddr string to check
 * @returns true if the address contains a private IP
 */
export function isPrivateAddress(addr: string): boolean {
  return PRIVATE_IP_PATTERNS.some(pattern => pattern.test(addr));
}

/**
 * Check if an address is a localhost address.
 * 
 * @param addr - Multiaddr string to check
 * @returns true if the address is localhost
 */
export function isLocalhostAddress(addr: string): boolean {
  return LOCALHOST_PATTERNS.some(pattern => pattern.test(addr));
}

/**
 * Check if an address is a Docker internal address.
 * 
 * @param addr - Multiaddr string to check
 * @returns true if the address is a Docker internal DNS name
 */
export function isDockerInternalAddress(addr: string): boolean {
  return DOCKER_INTERNAL_PATTERNS.some(pattern => pattern.test(addr));
}

/**
 * Check if an address is an internal (non-public) address.
 * 
 * @param addr - Multiaddr string to check
 * @returns true if the address is private, localhost, or Docker internal
 */
export function isInternalAddress(addr: string): boolean {
  return isPrivateAddress(addr) || isLocalhostAddress(addr) || isDockerInternalAddress(addr);
}

/**
 * Check if an address is a public WSS address.
 * 
 * @param addr - Multiaddr string to check
 * @returns true if the address uses dns4 and wss
 */
export function isPublicWssAddress(addr: string): boolean {
  return addr.includes('/dns4/') && (addr.includes('/wss/') || addr.endsWith('/wss'));
}

/**
 * Check if a browser node can dial the given address.
 * 
 * Browsers can only dial:
 * - WSS addresses (WebSocket Secure)
 * - WebRTC addresses
 * - Circuit relay addresses
 * 
 * @param addr - Multiaddr string to check
 * @returns true if a browser can dial this address
 */
export function canDialAddress(addr: string): boolean {
  // Must not be an internal address
  if (isInternalAddress(addr)) {
    return false;
  }
  
  // Check for dialable transports
  const hasWss = addr.includes('/wss/') || addr.endsWith('/wss');
  const hasWebRTC = addr.includes('/webrtc/') || addr.includes('/webrtc-direct/');
  const hasCircuitRelay = addr.includes('/p2p-circuit/') || addr.includes('/p2p-circuit');
  
  return hasWss || hasWebRTC || hasCircuitRelay;
}

/**
 * Filter a list of addresses to only those dialable by browsers.
 * 
 * @param addrs - Array of multiaddr strings
 * @returns Array of dialable addresses
 */
export function filterDialableAddresses(addrs: string[]): string[] {
  return addrs.filter(canDialAddress);
}

/**
 * Validate node address configuration.
 * 
 * Checks that:
 * - At least one public WSS address is configured
 * - No internal addresses are in the announce list
 * 
 * @param config - Node address configuration to validate
 * @returns Validation result with warnings
 */
export function validateNodeAddresses(config: NodeAddressConfig): AddressValidationResult {
  const warnings: string[] = [];
  let hasPublicAddress = false;
  let hasInternalAddress = false;

  for (const addr of config.announceAddresses) {
    if (isPublicWssAddress(addr) && !isInternalAddress(addr)) {
      hasPublicAddress = true;
    }
    if (isPrivateAddress(addr)) {
      hasInternalAddress = true;
      warnings.push(`Private IP address detected in announce addresses: ${addr}`);
    }
    if (isLocalhostAddress(addr)) {
      hasInternalAddress = true;
      warnings.push(`Localhost address detected in announce addresses: ${addr}`);
    }
    if (isDockerInternalAddress(addr)) {
      hasInternalAddress = true;
      warnings.push(`Docker internal address detected in announce addresses: ${addr}`);
    }
  }

  if (!hasPublicAddress) {
    warnings.push('No public WSS address configured in announce addresses');
  }

  if (!config.externalHost || config.externalHost === 'localhost') {
    warnings.push(`External host is not configured or is localhost: ${config.externalHost}`);
  }

  return {
    isValid: hasPublicAddress && !hasInternalAddress,
    hasPublicAddress,
    hasInternalAddress,
    warnings,
  };
}

/**
 * Build the public path for a DHT node based on its index.
 * 
 * @param nodeIndex - Node index (1-60)
 * @returns Public path string (e.g., "dht/node-1")
 */
export function buildDhtNodePath(nodeIndex: number): string {
  return `dht/node-${nodeIndex}`;
}

/**
 * Build the full announce address for a DHT node.
 * 
 * @param host - External hostname (e.g., "imeyouwe.com")
 * @param nodeIndex - Node index (1-60)
 * @returns Full multiaddr announce address
 */
export function buildDhtNodeAnnounceAddress(host: string, nodeIndex: number): string {
  const path = buildDhtNodePath(nodeIndex);
  return buildAnnounceAddress(host, path);
}

/**
 * Build the announce address for the bootstrap node.
 * 
 * @param host - External hostname (e.g., "imeyouwe.com")
 * @returns Full multiaddr announce address for bootstrap
 */
export function buildBootstrapAnnounceAddress(host: string): string {
  return buildAnnounceAddress(host, 'libp2p');
}
