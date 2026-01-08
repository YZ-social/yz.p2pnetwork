# Implementation Plan: Multi-Server DHT Infrastructure

## Overview

This plan implements a multi-server DHT infrastructure across 4 Oracle Cloud Free Tier ARM instances. The implementation is divided into phases: code updates for multi-server support, infrastructure provisioning, and deployment/validation.

## Tasks

- [x] 1. Update code for multi-server support
  - [x] 1.1 Add server configuration module
    - Create src/config/server-config.ts with ServerConfig and NodeConfig interfaces
    - Implement calculateGlobalIndex(serverIndex, localIndex) function
    - Implement getPublicPath(globalIndex) function
    - Implement getAnnounceAddress(host, globalIndex) function
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 1.2 Write property test for global index calculation
    - **Property 1: Global Index Uniqueness**
    - Test that for all valid (serverIndex, localIndex) pairs, global indices are unique
    - Test formula: (serverIndex - 1) * 15 + localIndex produces correct range
    - **Validates: Requirements 6.1, 6.2, 6.3**
  - [x] 1.3 Update src/cli/node.ts for cross-server bootstrap
    - Add CROSS_SERVER_BOOTSTRAPS environment variable parsing
    - Filter out self-server from bootstrap list
    - Update bootstrap connection logic to try all servers
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [x] 1.4 Update src/cli/ws-bridge.ts for cross-server bootstrap
    - Add CROSS_SERVER_BOOTSTRAPS environment variable parsing
    - Configure bootstrap node to connect to other servers' bootstraps
    - _Requirements: 5.1, 5.2_
  - [x] 1.5 Write property test for bootstrap configuration
    - **Property 2: Cross-Server Connectivity**
    - Test that bootstrap list includes addresses from all 4 servers
    - Test that self-server is correctly filtered out
    - **Validates: Requirements 5.1, 5.2**

- [ ] 2. Update Docker and deployment configuration
  - [ ] 2.1 Update docker-compose.yml for multi-server
    - Add SERVER_INDEX environment variable
    - Add NODES_PER_SERVER environment variable
    - Add CROSS_SERVER_BOOTSTRAPS environment variable
    - Update service definitions to use new variables
    - _Requirements: 4.3, 5.1, 6.1_
  - [ ] 2.2 Update scripts/generate-nginx-config.sh for global indexing
    - Accept SERVER_INDEX parameter
    - Calculate global node indices based on server index
    - Generate location blocks with global indices
    - _Requirements: 6.3_
  - [ ] 2.3 Create scripts/deploy-server.sh
    - Accept SERVER_INDEX and NODES_PER_SERVER parameters
    - Set EXTERNAL_HOST based on server index
    - Export environment variables for docker-compose
    - Call generate-nginx-config.sh with correct parameters
    - Start docker-compose with correct scale
    - _Requirements: 4.1, 4.2, 4.3_

- [ ] 3. Checkpoint - Verify code changes compile
  - Ensure all TypeScript compiles without errors
  - Ensure scripts are executable
  - Ask the user if questions arise

- [ ] 4. Create server provisioning documentation
  - [ ] 4.1 Create docs/multi-server-setup.md
    - Document OCI instance creation steps
    - Document security list configuration (ports 22, 80, 443)
    - Document SSH key setup
    - Document initial server setup (Docker, git, etc.)
    - _Requirements: 1.1, 1.2, 1.3, 1.5_
  - [ ] 4.2 Create scripts/setup-new-server.sh
    - Install Docker and docker-compose
    - Clone repository
    - Set up SSL certificate directory
    - Configure firewall (if needed)
    - _Requirements: 4.2_

- [ ] 5. SSL and DNS configuration
  - [ ] 5.1 Document DNS setup in docs/multi-server-setup.md
    - Add instructions for creating A records for subdomains
    - Document Cloudflare or other DNS provider setup
    - _Requirements: 2.1, 2.2, 2.3_
  - [ ] 5.2 Create scripts/setup-ssl.sh
    - Generate wildcard certificate using certbot with DNS challenge
    - Or generate individual certificates per server
    - Set up auto-renewal hooks
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 6. Deploy to oracle-yz (Server 1)
  - [ ] 6.1 Update oracle-yz with new code
    - SSH to oracle-yz and pull latest changes
    - Build Docker images
    - _Requirements: 4.4_
  - [ ] 6.2 Deploy with SERVER_INDEX=1
    - Run deploy-server.sh with SERVER_INDEX=1 NODES_PER_SERVER=15
    - Verify 15 nodes start with global indices 1-15
    - Verify cross-server bootstrap addresses are configured
    - _Requirements: 6.1, 6.2, 5.1_
  - [ ] 6.3 Validate oracle-yz deployment
    - Test /bootstrap/info returns correct configuration
    - Test /dht/node-1 through /dht/node-15 are accessible
    - Verify announce addresses use global indices
    - _Requirements: 6.3, 6.4_

- [ ] 7. Checkpoint - Verify Server 1 deployment
  - Ensure all 15 nodes are running
  - Ensure global indices are correct (1-15)
  - Ask the user if questions arise before provisioning new servers

- [ ] 8. Provision and deploy Server 2 (oracle-2)
  - [ ] 8.1 Provision oracle-2 instance in OCI
    - Create VM.Standard.A1.Flex with 1 OCPU, 6 GB RAM
    - Configure security list
    - Set up SSH access
    - _Requirements: 1.1, 1.2, 1.3, 1.5_
  - [ ] 8.2 Configure DNS for node2.imeyouwe.com
    - Add A record pointing to oracle-2 IP
    - Verify DNS resolution
    - _Requirements: 2.2, 2.3_
  - [ ] 8.3 Set up SSL on oracle-2
    - Copy wildcard certificate OR run certbot
    - Configure nginx SSL
    - _Requirements: 3.1_
  - [ ] 8.4 Deploy DHT to oracle-2
    - Clone repo and build
    - Run deploy-server.sh with SERVER_INDEX=2 NODES_PER_SERVER=15
    - Verify 15 nodes start with global indices 16-30
    - _Requirements: 6.1, 6.2_
  - [ ] 8.5 Validate cross-server connectivity
    - Verify oracle-2 nodes can connect to oracle-yz bootstrap
    - Verify oracle-yz nodes discover oracle-2 nodes
    - Check routing tables show nodes from both servers
    - _Requirements: 5.2, 5.3_

- [ ] 9. Provision and deploy Server 3 (oracle-3)
  - [ ] 9.1 Provision oracle-3 instance in OCI
    - Create VM.Standard.A1.Flex with 1 OCPU, 6 GB RAM
    - Configure security list
    - Set up SSH access
    - _Requirements: 1.1, 1.2, 1.3, 1.5_
  - [ ] 9.2 Configure DNS for node3.imeyouwe.com
    - Add A record pointing to oracle-3 IP
    - Verify DNS resolution
    - _Requirements: 2.2, 2.3_
  - [ ] 9.3 Set up SSL and deploy DHT to oracle-3
    - Copy/generate SSL certificate
    - Run deploy-server.sh with SERVER_INDEX=3 NODES_PER_SERVER=15
    - Verify 15 nodes start with global indices 31-45
    - _Requirements: 3.1, 6.1, 6.2_
  - [ ] 9.4 Validate 3-server mesh
    - Verify nodes from all 3 servers appear in routing tables
    - Test DHT queries return nodes from all servers
    - _Requirements: 5.2, 5.4_

- [ ] 10. Provision and deploy Server 4 (oracle-4)
  - [ ] 10.1 Provision oracle-4 instance in OCI
    - Create VM.Standard.A1.Flex with 1 OCPU, 6 GB RAM
    - Configure security list
    - Set up SSH access
    - _Requirements: 1.1, 1.2, 1.3, 1.5_
  - [ ] 10.2 Configure DNS for node4.imeyouwe.com
    - Add A record pointing to oracle-4 IP
    - Verify DNS resolution
    - _Requirements: 2.2, 2.3_
  - [ ] 10.3 Set up SSL and deploy DHT to oracle-4
    - Copy/generate SSL certificate
    - Run deploy-server.sh with SERVER_INDEX=4 NODES_PER_SERVER=15
    - Verify 15 nodes start with global indices 46-60
    - _Requirements: 3.1, 6.1, 6.2_

- [ ] 11. Validate full 4-server deployment
  - [ ] 11.1 Verify all 60 nodes are running
    - Check each server has 15 healthy nodes
    - Verify global indices span 1-60 without gaps
    - _Requirements: 6.1, 6.2_
  - [ ] 11.2 Test cross-server DHT operations
    - Query DHT from each server, verify nodes from all servers returned
    - Store data on server 1, retrieve from server 4
    - Test provider records work across servers
    - _Requirements: 5.2, 8.6_
  - [ ] 11.3 Test external client connectivity
    - Connect browser client to each server's bootstrap
    - Verify client discovers nodes from all 4 servers
    - Test overlay echo across servers
    - _Requirements: 5.4_

- [ ] 12. Test graceful degradation
  - [ ] 12.1 Test single server failure
    - Stop oracle-2 containers
    - Verify clients on other servers continue operating
    - Verify DHT queries still return results (from remaining servers)
    - Restart oracle-2, verify it rejoins network
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [ ] 12.2 Test data availability during failure
    - Store data, note which nodes hold it
    - Stop server hosting some replicas
    - Verify data still retrievable from remaining replicas
    - _Requirements: 8.5, 8.6, 8.7_

- [ ] 13. Add health monitoring
  - [ ] 13.1 Add /health endpoint to each server
    - Return server status, node count, connection count
    - Include cross-server connectivity status
    - _Requirements: 7.1_
  - [ ] 13.2 Add aggregated health endpoint to primary server
    - Query health from all servers
    - Return combined network status
    - _Requirements: 7.2, 7.4_
  - [ ] 13.3 Write property test for health aggregation
    - **Property 3: Health Aggregation**
    - Test that aggregated health correctly combines server statuses
    - Test that metrics sum correctly across servers
    - **Validates: Requirements 7.2, 7.4**

- [ ] 14. Final checkpoint
  - Ensure all 60 nodes are running across 4 servers
  - Ensure cross-server DHT operations work
  - Ensure graceful degradation works
  - Document any issues or observations
  - Ask the user if questions arise

## Notes

- All tasks are required for comprehensive coverage
- Infrastructure tasks (8, 9, 10) require OCI console access
- DNS tasks require access to domain registrar/Cloudflare
- SSL tasks may require DNS challenge for wildcard certs
- Each server deployment should be validated before proceeding to next

## Key Commands

```bash
# Deploy to a specific server
./scripts/deploy-server.sh <SERVER_INDEX> <NODES_PER_SERVER>

# Example: Deploy 15 nodes to server 2
./scripts/deploy-server.sh 2 15

# Check server health
curl https://node2.imeyouwe.com/health

# Check aggregated network health
curl https://imeyouwe.com/network/health
```

## Rollback

```bash
# If issues arise, scale back to single server
# On secondary servers:
ssh oracle-2 "cd ~/libp2p-dht && docker-compose down"
ssh oracle-3 "cd ~/libp2p-dht && docker-compose down"
ssh oracle-4 "cd ~/libp2p-dht && docker-compose down"

# On primary server, revert to single-server config
ssh oracle-yz "cd ~/libp2p-dht && git checkout src/cli/node.ts && docker-compose down && docker-compose up -d"
```
