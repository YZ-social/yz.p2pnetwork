# Requirements Document: Multi-Server DHT Infrastructure

## Introduction

This document specifies the requirements for scaling the DHT network across multiple Oracle Cloud Free Tier servers. The goal is to deploy 60 DHT nodes across 4 ARM instances, each running 15 nodes, while staying within the free tier limits.

## Problem Statement

Current state:
- Single server (oracle-yz) running infrastructure (bootstrap, webserver) + 15 DHT nodes
- Using 1 OCPU and 6 GB RAM of the free tier allocation
- 3 more OCPUs and 18 GB RAM available in free tier
- Need to scale to 60 nodes for a robust DHT network

Target state:
- 4 ARM instances, each with 1 OCPU and 6 GB RAM
- 60 total DHT nodes (15 per server)
- Cross-server DHT mesh network
- All within Oracle Cloud Free Tier limits (4 OCPU, 24 GB total)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Public DHT Network                                   │
│                                                                              │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│   │   Phone      │  │   Desktop    │  │   Browser    │  │   Other      │   │
│   │   Clients    │  │   Clients    │  │   Clients    │  │   Nodes      │   │
│   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│          │                 │                 │                 │            │
│          └─────────────────┴────────┬────────┴─────────────────┘            │
│                                     │                                        │
│     ┌───────────────────────────────┼───────────────────────────────┐       │
│     │                               │                               │       │
│     ▼                               ▼                               ▼       │
│ ┌─────────────┐             ┌─────────────┐             ┌─────────────┐     │
│ │ oracle-yz   │◄───────────►│ oracle-2    │◄───────────►│ oracle-3    │     │
│ │ imeyouwe.com│             │ node2.      │             │ node3.      │     │
│ │ 15 nodes    │             │ imeyouwe.com│             │ imeyouwe.com│     │
│ │ bootstrap   │             │ 15 nodes    │             │ 15 nodes    │     │
│ └─────────────┘             └─────────────┘             └─────────────┘     │
│        ▲                           ▲                           ▲            │
│        │                           │                           │            │
│        └───────────────────────────┼───────────────────────────┘            │
│                                    │                                        │
│                                    ▼                                        │
│                            ┌─────────────┐                                  │
│                            │ oracle-4    │                                  │
│                            │ node4.      │                                  │
│                            │ imeyouwe.com│                                  │
│                            │ 15 nodes    │                                  │
│                            └─────────────┘                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Glossary

- **Primary_Server**: oracle-yz, hosts the main bootstrap node and web UI at imeyouwe.com
- **Secondary_Server**: Additional Oracle ARM instances (oracle-2, oracle-3, oracle-4)
- **Bootstrap_Node**: Entry point for new clients joining the DHT network
- **Cross_Server_Bootstrap**: List of bootstrap addresses from all servers for cross-server discovery
- **Server_Index**: Unique identifier for each server (1-4)
- **Node_Global_Index**: Unique node ID across all servers (1-60)

## Requirements

### Requirement 1: Oracle Cloud Instance Provisioning

**User Story:** As a network operator, I want to provision additional Oracle Cloud instances, so that I can distribute DHT nodes across multiple servers.

#### Acceptance Criteria

1. WHEN provisioning a new instance THEN IT SHALL use the VM.Standard.A1.Flex shape with 1 OCPU and 6 GB RAM
2. EACH instance SHALL have a unique hostname (oracle-2, oracle-3, oracle-4)
3. EACH instance SHALL be configured with SSH access using the same key as oracle-yz
4. THE total resource usage SHALL NOT exceed Oracle Free Tier limits (4 OCPU, 24 GB RAM total)
5. EACH instance SHALL have ports 80, 443, and 4001 open in the security list

### Requirement 2: DNS Configuration

**User Story:** As a network operator, I want each server to have a unique subdomain, so that clients can connect to nodes on any server.

#### Acceptance Criteria

1. THE Primary_Server SHALL use the domain `imeyouwe.com`
2. EACH Secondary_Server SHALL have a subdomain: `node2.imeyouwe.com`, `node3.imeyouwe.com`, `node4.imeyouwe.com`
3. EACH subdomain SHALL resolve to the corresponding server's public IP
4. WHEN a client connects to any subdomain THEN IT SHALL reach the correct server

### Requirement 3: SSL Certificate Management

**User Story:** As a network operator, I want SSL certificates for all subdomains, so that clients can connect securely via WSS.

#### Acceptance Criteria

1. EACH server SHALL have a valid SSL certificate for its domain/subdomain
2. THE Primary_Server certificate SHALL cover `imeyouwe.com` and `*.imeyouwe.com` (wildcard) OR individual certs per server
3. WHEN a certificate expires THEN IT SHALL be automatically renewed
4. IF using Let's Encrypt THEN certbot SHALL be configured for automatic renewal

### Requirement 4: Server Deployment Automation

**User Story:** As a network operator, I want automated deployment scripts, so that I can easily set up and update all servers.

#### Acceptance Criteria

1. THE system SHALL provide a script to deploy the DHT application to any server
2. WHEN deploying to a new server THEN the script SHALL install Docker, clone the repo, and start services
3. THE deployment script SHALL accept parameters for server index and node count
4. WHEN updating the application THEN the script SHALL pull latest code and restart containers

### Requirement 5: Cross-Server Bootstrap Configuration

**User Story:** As a DHT node, I want to know about bootstrap nodes on other servers, so that I can join the full network mesh.

#### Acceptance Criteria

1. EACH server's nodes SHALL be configured with bootstrap addresses from ALL servers
2. THE bootstrap list SHALL include at least one node from each server
3. WHEN a node starts THEN IT SHALL attempt to connect to bootstrap nodes on all servers
4. IF a bootstrap server is unreachable THEN the node SHALL continue with available bootstraps

### Requirement 6: Node Indexing Across Servers

**User Story:** As a network operator, I want globally unique node indices, so that each node has a distinct identity.

#### Acceptance Criteria

1. EACH server SHALL have a Server_Index (1, 2, 3, 4)
2. EACH node SHALL have a Node_Global_Index calculated as: `(Server_Index - 1) * 15 + Local_Index`
3. THE node's public path SHALL be `/dht/node-{Node_Global_Index}`
4. WHEN displaying node info THEN IT SHALL show both global and local indices

### Requirement 7: Health Monitoring Across Servers

**User Story:** As a network operator, I want to monitor the health of all servers and nodes, so that I can ensure network reliability.

#### Acceptance Criteria

1. EACH server SHALL expose a health endpoint at `/health`
2. THE Primary_Server SHALL aggregate health status from all servers
3. WHEN a server is unhealthy THEN IT SHALL be flagged in the monitoring dashboard
4. THE system SHALL provide metrics for total nodes, connections, and DHT operations

### Requirement 8: Graceful Degradation and Data Redistribution

**User Story:** As a client, I want the network to remain functional and my data to remain available if a server goes down, so that I can continue using the DHT without data loss.

#### Acceptance Criteria

1. WHEN a server goes offline THEN clients connected to other servers SHALL continue operating
2. THE DHT routing table SHALL automatically remove unreachable nodes
3. WHEN a server comes back online THEN its nodes SHALL rejoin the network automatically
4. THE network SHALL remain functional with as few as 1 server operational
5. WHEN a node detects peer disconnection THEN IT SHALL trigger data replication to maintain redundancy
6. THE DHT SHALL store each key-value pair on at least K closest nodes (replication factor)
7. WHEN nodes become unavailable THEN remaining nodes SHALL re-replicate data to maintain the replication factor
8. THE system SHALL use Kademlia's republish mechanism to periodically refresh data across the network

## Resource Allocation

| Server | Hostname | Domain | OCPUs | RAM | Nodes | Global Index Range |
|--------|----------|--------|-------|-----|-------|-------------------|
| oracle-yz | oracle-yz | imeyouwe.com | 1 | 6 GB | 15 | 1-15 |
| oracle-2 | oracle-2 | node2.imeyouwe.com | 1 | 6 GB | 15 | 16-30 |
| oracle-3 | oracle-3 | node3.imeyouwe.com | 1 | 6 GB | 15 | 31-45 |
| oracle-4 | oracle-4 | node4.imeyouwe.com | 1 | 6 GB | 15 | 46-60 |

**Total: 4 OCPUs, 24 GB RAM, 60 nodes** (within Oracle Free Tier)

## Success Criteria

1. All 4 servers are provisioned and running within Oracle Free Tier
2. Each server runs 15 DHT nodes accessible via public WSS addresses
3. Nodes on different servers can discover and connect to each other
4. External clients can bootstrap from any server and discover all 60 nodes
5. The network remains functional if 1-2 servers go offline
6. Deployment and updates can be performed with a single command per server
