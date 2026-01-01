#!/bin/bash
#
# DockerServerRestart.sh - Restart the libp2p DHT network
#
# This script is a convenience wrapper that stops and restarts the network.
# It pulls latest code, rebuilds images, and restarts all services.
#
# Usage: ./scripts/DockerServerRestart.sh [num_dht_nodes]
#   num_dht_nodes: Number of DHT nodes to start (default: 15)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================="
echo "  libp2p DHT Network Restart"
echo "=========================================="
echo ""

# DockerServerUp.sh handles everything:
# 1. git pull
# 2. docker compose build
# 3. docker compose down
# 4. docker compose up (bootstrap + webserver)
# 5. docker compose up --scale dht-node=N

exec "$SCRIPT_DIR/DockerServerUp.sh" "$@"
