#!/bin/bash
# Deploy libp2p DHT network to oracle-yz
set -e

REMOTE_HOST="oracle-yz"
REMOTE_DIR="/home/ubuntu/libp2p-dht"
NUM_NODES=${1:-15}

echo "=== Deploying libp2p DHT to $REMOTE_HOST ==="

# Create remote directory
echo "Creating remote directory..."
ssh $REMOTE_HOST "mkdir -p $REMOTE_DIR/nginx"

# Copy files
echo "Copying files..."
scp Dockerfile $REMOTE_HOST:$REMOTE_DIR/
scp .dockerignore $REMOTE_HOST:$REMOTE_DIR/
scp docker-compose.yml $REMOTE_HOST:$REMOTE_DIR/
scp package.json $REMOTE_HOST:$REMOTE_DIR/
scp package-lock.json $REMOTE_HOST:$REMOTE_DIR/
scp tsconfig.json $REMOTE_HOST:$REMOTE_DIR/
scp -r src $REMOTE_HOST:$REMOTE_DIR/
scp nginx/nginx.conf $REMOTE_HOST:$REMOTE_DIR/nginx/

# Build and start
echo "Building Docker image..."
ssh $REMOTE_HOST "cd $REMOTE_DIR && docker compose build"

echo "Starting bootstrap node..."
ssh $REMOTE_HOST "cd $REMOTE_DIR && docker compose up -d bootstrap webserver"

echo "Waiting for bootstrap to be healthy..."
sleep 15

echo "Starting $NUM_NODES DHT nodes..."
ssh $REMOTE_HOST "cd $REMOTE_DIR && docker compose up -d --scale dht-node=$NUM_NODES"

echo "=== Deployment complete ==="
echo "Bootstrap: https://imeyouwe.com/ws"
echo "Info: https://imeyouwe.com/bootstrap/info"
echo "Metrics: https://imeyouwe.com/bootstrap/metrics"
