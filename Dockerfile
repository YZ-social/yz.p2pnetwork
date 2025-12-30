FROM node:22-alpine

WORKDIR /app

# Install wget for health checks
RUN apk add --no-cache wget

# Install dependencies first for better caching
COPY package*.json ./
RUN npm ci

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Health check endpoint will be on port 9090
EXPOSE 4001 8080 9090

# Default command
CMD ["node", "dist/cli/node.js"]
