#!/bin/bash
# Deploy libp2p DHT network to oracle-yz
# Creates individual DHT nodes with unique NODE_INDEX for public address routing
set -e

REMOTE_HOST="oracle-yz"
REMOTE_DIR="/home/ubuntu/libp2p-dht"
NUM_NODES=${1:-15}

echo "=== Deploying libp2p DHT to $REMOTE_HOST ==="
echo "Number of DHT nodes: $NUM_NODES"

# Create remote directory
echo "Creating remote directory..."
ssh $REMOTE_HOST "mkdir -p $REMOTE_DIR/nginx $REMOTE_DIR/scripts"

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

# Copy and generate nginx config for DHT nodes
if [ -f "nginx/dht-nodes.conf" ]; then
    scp nginx/dht-nodes.conf $REMOTE_HOST:$REMOTE_DIR/nginx/
fi
if [ -f "scripts/generate-nginx-config.sh" ]; then
    scp scripts/generate-nginx-config.sh $REMOTE_HOST:$REMOTE_DIR/scripts/
    ssh $REMOTE_HOST "chmod +x $REMOTE_DIR/scripts/generate-nginx-config.sh"
    echo "Generating nginx config for $NUM_NODES nodes..."
    ssh $REMOTE_HOST "cd $REMOTE_DIR && ./scripts/generate-nginx-config.sh $NUM_NODES"
fi

# Build Docker image
echo "Building Docker image..."
ssh $REMOTE_HOST "cd $REMOTE_DIR && docker compose build"

# Stop existing containers
echo "Stopping existing containers..."
ssh $REMOTE_HOST "cd $REMOTE_DIR && docker compose down --remove-orphans 2>/dev/null || true"

# Remove old DHT node containers
echo "Removing old DHT node containers..."
ssh $REMOTE_HOST "docker rm -f \$(docker ps -aq --filter 'name=libp2p-dht-dht-node-') 2>/dev/null || true"

# Start bootstrap and webserver
echo "Starting bootstrap node and webserver..."
ssh $REMOTE_HOST "cd $REMOTE_DIR && docker compose up -d bootstrap webserver"

echo "Waiting for bootstrap to be healthy..."
sleep 15

# Start individual DHT nodes with unique NODE_INDEX
echo "Starting $NUM_NODES DHT nodes with unique indices..."
for i in $(seq 1 $NUM_NODES); do
    echo "  Starting dht-node-$i..."
    ssh $REMOTE_HOST "cd $REMOTE_DIR && NODE_INDEX=$i docker compose run -d \
        --name libp2p-dht-dht-node-$i \
        --no-deps \
        -e NODE_INDEX=$i \
        -e NODE_ID=node-$i \
        -e PUBLIC_PATH=/dht/node-$i \
        dht-node"
done

echo "Waiting for nodes to start..."
sleep 10

# Verify containers are running
echo "Verifying containers..."
ssh $REMOTE_HOST "docker ps --filter 'name=libp2p-dht' --format 'table {{.Names}}\t{{.Status}}'"

echo ""
echo "=== Deployment complete ==="
echo "Bootstrap: https://imeyouwe.com/ws"
echo "Info: https://imeyouwe.com/bootstrap/info"
echo "Metrics: https://imeyouwe.com/bootstrap/metrics"
echo ""
echo "DHT Nodes:"
for i in $(seq 1 $NUM_NODES); do
    echo "  Node $i: https://imeyouwe.com/dht/node-$i"
done
