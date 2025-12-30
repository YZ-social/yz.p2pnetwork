#!/bin/bash
#
# DockerServerUp.sh - Start the libp2p DHT network on Docker
#
# This script pulls the latest code, builds Docker images, and starts
# the DHT network with bootstrap node, webserver, and DHT nodes.
#
# Usage: ./scripts/DockerServerUp.sh [num_dht_nodes]
#   num_dht_nodes: Number of DHT nodes to start (default: 15)
#

set -e

# Configuration
DHT_NODES=${1:-15}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "  libp2p DHT Network Startup Script"
echo "=========================================="
echo ""
echo "Configuration:"
echo "  - DHT Nodes: $DHT_NODES"
echo "  - Project Dir: $PROJECT_DIR"
echo ""

cd "$PROJECT_DIR"

# Step 1: Pull latest code from git
echo "[1/5] Pulling latest code from git..."
git pull
echo "      Done."
echo ""

# Step 2: Build Docker images
echo "[2/5] Building Docker images..."
docker compose build
echo "      Done."
echo ""

# Step 3: Stop any existing containers
echo "[3/5] Stopping existing containers..."
docker compose down 2>/dev/null || true
echo "      Done."
echo ""

# Step 4: Start bootstrap node and webserver
echo "[4/5] Starting bootstrap node and webserver..."
docker compose up -d bootstrap webserver
echo "      Waiting for bootstrap node to be healthy..."

# Wait for bootstrap to be healthy (max 60 seconds)
for i in {1..60}; do
    if docker compose ps bootstrap | grep -q "healthy"; then
        echo "      Bootstrap node is healthy."
        break
    fi
    if [ $i -eq 60 ]; then
        echo "      Warning: Bootstrap node health check timed out."
    fi
    sleep 1
done
echo ""

# Step 5: Start DHT nodes
echo "[5/5] Starting $DHT_NODES DHT nodes..."
docker compose up -d --scale dht-node=$DHT_NODES
echo "      Done."
echo ""

# Wait a moment for nodes to connect
echo "Waiting for DHT nodes to connect..."
sleep 10

# Show status
echo ""
echo "=========================================="
echo "  Network Status"
echo "=========================================="
docker compose ps
echo ""

# Try to get bootstrap info
echo "Bootstrap node info:"
curl -s http://localhost:9090/info 2>/dev/null | head -20 || echo "  (Could not fetch bootstrap info)"
echo ""

echo "=========================================="
echo "  Startup Complete!"
echo "=========================================="
echo ""
echo "Endpoints:"
echo "  - Web UI:        https://imeyouwe.com/"
echo "  - WebSocket:     wss://imeyouwe.com/ws"
echo "  - Bootstrap Info: https://imeyouwe.com/bootstrap/info"
echo "  - Metrics:       https://imeyouwe.com/bootstrap/metrics"
echo ""
echo "To view logs:      docker compose logs -f"
echo "To stop network:   docker compose down"
echo ""
