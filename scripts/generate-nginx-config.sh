#!/bin/bash
# Generate nginx configuration for DHT nodes
# Usage: ./scripts/generate-nginx-config.sh [NUM_NODES]
#
# This script generates nginx upstream and location blocks for routing
# WebSocket connections to individual DHT nodes.
#
# Requirements: 2.1, 2.2, 2.3, 2.5, 6.1, 6.2

set -e

NUM_NODES=${1:-5}
OUTPUT_FILE="nginx/dht-nodes.conf"

# Validate input
if ! [[ "$NUM_NODES" =~ ^[0-9]+$ ]] || [ "$NUM_NODES" -lt 1 ] || [ "$NUM_NODES" -gt 100 ]; then
    echo "Error: NUM_NODES must be a number between 1 and 100"
    exit 1
fi

echo "Generating nginx config for $NUM_NODES DHT nodes..."

# Create output directory if it doesn't exist
mkdir -p "$(dirname "$OUTPUT_FILE")"

# Start the config file with header
cat > "$OUTPUT_FILE" << 'EOF'
# Auto-generated DHT node routing configuration
# Do not edit manually - regenerate with scripts/generate-nginx-config.sh
#
# This file is included by nginx.conf and provides:
# - Upstream blocks for each DHT node
# - Location blocks for /dht/node-N paths with WebSocket support

EOF

# Generate upstream blocks for each node
echo "# ============================================" >> "$OUTPUT_FILE"
echo "# Upstream definitions for DHT nodes" >> "$OUTPUT_FILE"
echo "# ============================================" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

for i in $(seq 1 $NUM_NODES); do
    cat >> "$OUTPUT_FILE" << EOF
upstream dht-node-$i {
    server libp2p-dht-dht-node-$i:4001;
}

EOF
done

# Generate location blocks for each node
echo "# ============================================" >> "$OUTPUT_FILE"
echo "# Location blocks for DHT node WebSocket routing" >> "$OUTPUT_FILE"
echo "# ============================================" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

for i in $(seq 1 $NUM_NODES); do
    cat >> "$OUTPUT_FILE" << EOF
location /dht/node-$i {
    proxy_pass http://dht-node-$i;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
}

EOF
done

echo "Generated $OUTPUT_FILE with $NUM_NODES node configurations"
echo ""
echo "To use this configuration:"
echo "  1. Add 'include /etc/nginx/conf.d/dht-nodes.conf;' to your nginx server block"
echo "  2. Reload nginx: nginx -s reload"
echo ""
echo "Node endpoints will be available at:"
echo "  wss://imeyouwe.com/dht/node-1 through wss://imeyouwe.com/dht/node-$NUM_NODES"
