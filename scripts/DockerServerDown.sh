#!/bin/bash
#
# DockerServerDown.sh - Stop the libp2p DHT network
#
# This script stops all Docker containers for the DHT network.
#
# Usage: ./scripts/DockerServerDown.sh [--clean]
#   --clean: Also remove Docker images and volumes
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "  libp2p DHT Network Shutdown Script"
echo "=========================================="
echo ""

cd "$PROJECT_DIR"

# Show current status
echo "Current containers:"
docker compose ps 2>/dev/null || echo "  No containers running."
echo ""

# Stop all containers
echo "Stopping all containers..."
docker compose down
echo "Done."
echo ""

# Clean up if requested
if [ "$1" == "--clean" ]; then
    echo "Cleaning up Docker images and volumes..."
    docker compose down --rmi local --volumes 2>/dev/null || true
    echo "Done."
    echo ""
fi

echo "=========================================="
echo "  Shutdown Complete!"
echo "=========================================="
echo ""
echo "To restart: ./scripts/DockerServerUp.sh"
echo ""
