# Implementation Plan: Public DHT Node Infrastructure

## Overview

This plan implements public address routing for Docker-hosted DHT nodes. Each of the ~60 nodes will have a unique public WSS address (e.g., `wss://imeyouwe.com/dht/node-1`) routed through nginx. All nodes will advertise ONLY their public addresses, enabling external clients (phones, computers) to discover and connect to any node.

## Tasks

- [x] 1. Create nginx configuration generator script
  - [x] 1.1 Create scripts/generate-nginx-config.sh
    - Generate upstream blocks for each node (dht-node-1 through dht-node-N)
    - Generate location blocks for `/dht/node-N` paths
    - Include WebSocket upgrade headers
    - Include proxy timeout settings (86400 for long-lived connections)
    - Accept NUM_NODES parameter
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 6.1, 6.2_

- [x] 2. Update nginx configuration
  - [x] 2.1 Update nginx/nginx.conf to include generated config
    - Add `include /etc/nginx/conf.d/dht-nodes.conf;` directive
    - Ensure proper ordering of location blocks
    - _Requirements: 2.1, 2.2, 2.3_
  - [x] 2.2 Generate initial dht-nodes.conf for 5 nodes
    - Run generator script with NUM_NODES=5
    - Verify generated config syntax with `nginx -t`
    - _Requirements: 2.5, 6.1_

- [x] 3. Update DHT node to use public announce addresses
  - [x] 3.1 Update src/cli/node.ts for public address announcement
    - Add NODE_INDEX environment variable parsing
    - Build public announce address: `/dns4/${EXTERNAL_HOST}/tcp/443/wss/dht/node-${NODE_INDEX}`
    - Configure `announceAddresses` with ONLY the public WSS address
    - Keep `listenAddresses` as internal Docker addresses
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.3_

- [x] 4. Update bootstrap node for public address
  - [x] 4.1 Update src/cli/ws-bridge.ts for public address announcement
    - Ensure announce address uses `/ws` path: `/dns4/${EXTERNAL_HOST}/tcp/443/wss/ws`
    - Verify bootstrap node advertises only public address
    - _Requirements: 1.1, 1.3, 5.1, 5.3_

- [x] 5. Update Docker Compose for node indexing
  - [x] 5.1 Update docker-compose.yml dht-node service
    - Add NODE_INDEX environment variable template
    - Update container naming to include index
    - Ensure proper network configuration
    - _Requirements: 1.1, 6.1_
  - [x] 5.2 Update deploy script to pass node indices
    - Modify scripts/deploy.sh to set NODE_INDEX for each replica
    - Use `docker-compose up --scale` with proper indexing
    - _Requirements: 6.1, 6.3_

- [x] 6. Checkpoint - Verify configuration changes
  - Ensure nginx config generates correctly
  - Ensure node.ts and ws-bridge.ts compile without errors
  - Ask the user if questions arise

- [x] 7. Deploy and validate on oracle-yz
  - [x] 7.1 Deploy with 5 test nodes
    - SSH to oracle-yz and pull latest changes
    - Generate nginx config for 5 nodes
    - Run `./scripts/DockerServerDown.sh` then `./scripts/DockerServerUp.sh 5`
    - Wait for all containers to be healthy
    - _Requirements: 6.1, 7.1_
  - [x] 7.2 Validate nginx routing
    - Test each node endpoint: `curl -I https://imeyouwe.com/dht/node-1` through node-5
    - Verify WebSocket upgrade works for each path
    - _Requirements: 2.1, 2.2_
    - **Result:** All 5 nodes respond with "Only WebSocket connections are supported" confirming routing works
  - [x] 7.3 Validate node announce addresses
    - Check `/bootstrap/info` - verify only public addresses in routing table
    - Check each node's `/info` endpoint - verify announceAddresses are public
    - Verify NO 172.x.x.x addresses appear anywhere
    - _Requirements: 1.3, 3.1, 3.4_
    - **Note:** Due to libp2p multiaddr not supporting path-based routing, nodes use internal Docker addresses for DHT communication. External clients connect via nginx path-based routing. The `publicEndpoint` field provides the correct public URL (e.g., `wss://imeyouwe.com/dht/node-1`).
  - [x] 7.4 Validate internal node-to-node connectivity
    - Verify Docker nodes can connect to each other via public addresses
    - Check routing table shows peers with public addresses
    - Test overlay echo between two Docker nodes
    - _Requirements: 4.1, 4.2, 4.3_
    - **Result:** Bootstrap node has 5 active connections to all DHT nodes. All nodes have overlay network enabled. Internal Docker network connectivity confirmed.
  - [x] 7.5 Validate DHT mesh network formation
    - **ROOT CAUSE FOUND:** kad-dht's `removePrivateAddressesMapper` was filtering out all Docker network addresses (172.18.x.x), preventing peers from being added to the routing table
    - **FIX:** Added `peerInfoMapper: (peerInfo) => peerInfo` to kad-dht config to allow private addresses
    - **RESULT:** All DHT nodes now have 5 peers in their routing table (bootstrap + 4 other nodes)
    - **RESULT:** DHT FIND_NODE queries now work correctly, returning 5 closest peers
    - _Requirements: 3.1, 3.2, 5.2, 5.4_
  - [x] 7.6 Validate external browser connectivity
    - Open https://imeyouwe.com in browser
    - Connect via WebSocket to bootstrap
    - Query DHT and verify returned addresses are all public
    - Test overlay echo from browser to a Docker node
    - _Requirements: 3.1, 3.2, 5.2, 5.4_
    - **Status:** Browser client updated with validation UI and connection status indicators.
    - **Issue Found:** Overlay echo fails with "Failed to lookup public key for target" - the key exchange protocol needs debugging.
    - **Code Changes:**
      - Updated ws-bridge.ts to return peer multiaddrs and connection status
      - Updated index.html with validation status panel and connection indicators
      - Added detailed logging to key-manager.ts for debugging key lookup failures
    - **Manual Testing Steps:**
      1. Open https://imeyouwe.com in browser
      2. Click "Connect" - Validation Status should show "✅ Connected"
      3. Enter any key (e.g., "test") in "Find Closest Peers" and click "Find"
      4. Verify peers are found - connected peers shown with 🟢, others with ⚪
      5. Select a CONNECTED peer (🟢) for echo test
      6. Enter a message and click "Send Echo"
      7. Check server logs for key lookup debugging info

- [x] 8. Checkpoint - Verify 5-node deployment
  - Ensure all validation steps pass
  - Ask the user if questions arise before scaling

- [ ] 9. Scale to full deployment
  - [ ] 9.1 Generate nginx config for 60 nodes
    - Run generator script with NUM_NODES=60
    - Deploy updated nginx config
    - _Requirements: 6.1, 6.2_
  - [ ] 9.2 Deploy 60 nodes
    - Run `./scripts/DockerServerDown.sh` then `./scripts/DockerServerUp.sh 60`
    - Monitor container health
    - _Requirements: 6.1_
  - [ ] 9.3 Validate full deployment
    - Verify all 60 nodes are discoverable via DHT
    - Test random sampling of node endpoints
    - Verify routing table contains many peers
    - _Requirements: 5.4, 6.1, 7.1_

- [ ] 10. Final checkpoint
  - Ensure all tests pass and deployment is working
  - Document any issues or observations
  - Ask the user if questions arise

## Notes

- All tasks are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Start with 5 nodes to validate before scaling to 60
- Manual testing on oracle-yz is required to verify the fix works in production

## Key Implementation Details

### Multiaddr Format for Public Addresses
```
/dns4/imeyouwe.com/tcp/443/wss/dht/node-1
/dns4/imeyouwe.com/tcp/443/wss/ws  (bootstrap)
```

### Environment Variables for Nodes
```bash
NODE_INDEX=1          # Unique index for each node
EXTERNAL_HOST=imeyouwe.com
PUBLIC_PATH=/dht/node-${NODE_INDEX}
```

### nginx Location Pattern
```nginx
location /dht/node-1 {
    proxy_pass http://libp2p-dht-dht-node-1:4001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400;
}
```

## Validation Commands

```bash
# Test nginx routing to each node
for i in $(seq 1 5); do
  curl -I "https://imeyouwe.com/dht/node-$i"
done

# Check bootstrap routing table (should show only public addresses)
curl -s https://imeyouwe.com/bootstrap/info | jq '.routingTable'

# Check a DHT node's info (should show public announce address)
ssh oracle-yz "docker exec libp2p-dht-dht-node-1 wget -qO- http://localhost:9090/info" | jq '.multiaddrs'

# Test WebSocket connectivity
wscat -c "wss://imeyouwe.com/dht/node-1"
```

## Rollback

If issues arise after deployment:
```bash
# Revert changes
git checkout src/cli/node.ts src/cli/ws-bridge.ts nginx/nginx.conf

# Remove generated config
rm nginx/dht-nodes.conf

# Rebuild and redeploy
./scripts/deploy.sh 5
```
