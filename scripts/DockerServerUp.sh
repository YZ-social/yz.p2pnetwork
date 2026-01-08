#!/bin/bash
#
# DockerServerUp.sh - Start the libp2p DHT network on Docker
#
# This script pulls the latest code, builds Docker images, and starts
# the DHT network with bootstrap node, webserver, and DHT nodes.
# Each DHT node gets a unique NODE_INDEX for public address routing.
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
echo "[1/6] Pulling latest code from git..."
git pull
echo "      Done."
echo ""

# Step 2: Install npm dependencies and build browser bundle
echo "[2/7] Installing npm dependencies..."
npm ci
echo "      Done."
echo ""

echo "[3/7] Building browser bundle..."
npm run build:browser
echo "      Done."
echo ""

# Step 3: Generate nginx config for DHT nodes
echo "[4/7] Generating nginx config for $DHT_NODES nodes..."
if [ -f "scripts/generate-nginx-config.sh" ]; then
    chmod +x scripts/generate-nginx-config.sh
    ./scripts/generate-nginx-config.sh $DHT_NODES
    echo "      Done."
else
    echo "      Warning: generate-nginx-config.sh not found, skipping."
fi
echo ""

# Step 4: Build Docker images
echo "[5/7] Building Docker images..."
docker compose build
echo "      Done."
echo ""

# Step 5: Stop any existing containers
echo "[6/7] Stopping existing containers..."
docker compose down --remove-orphans 2>/dev/null || true
# Remove old DHT node containers
docker rm -f $(docker ps -aq --filter 'name=libp2p-dht-dht-node-') 2>/dev/null || true
echo "      Done."
echo ""

# Step 6: Start bootstrap node and webserver
echo "[7/7] Starting bootstrap node and webserver..."
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

# Step 6: Start DHT nodes with unique NODE_INDEX
echo "[6/6] Starting $DHT_NODES DHT nodes with unique indices..."
for i in $(seq 1 $DHT_NODES); do
    echo "      Starting dht-node-$i..."
    NODE_INDEX=$i docker compose run -d \
        --name libp2p-dht-dht-node-$i \
        --no-deps \
        -e NODE_INDEX=$i \
        -e NODE_ID=node-$i \
        -e PUBLIC_PATH=/dht/node-$i \
        dht-node
done
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
docker ps --filter 'name=libp2p-dht' --format 'table {{.Names}}\t{{.Status}}'
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
echo "DHT Nodes:"
for i in $(seq 1 $DHT_NODES); do
    echo "  - Node $i: https://imeyouwe.com/dht/node-$i"
done
echo ""
echo "To view logs:      docker compose logs -f"
echo "To stop network:   ./scripts/DockerServerDown.sh"
echo ""
