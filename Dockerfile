# Hero API Server Dockerfile
# This Dockerfile builds and runs the Hero Core as a WebSocket API server

FROM node:18-bookworm-slim AS base

# Install Chrome/Chromium dependencies and required tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Chrome dependencies
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxkbcommon0 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    # Build dependencies for native modules
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Create app user for security
RUN groupadd -r hero && useradd -r -g hero -G audio,video hero \
    && mkdir -p /home/hero/Downloads \
    && chown -R hero:hero /home/hero

# Set working directory
WORKDIR /app

# ============================================
# Build stage - compile TypeScript
# ============================================
FROM base AS builder

# Copy package files for dependency installation
COPY package.json yarn.lock ./
COPY tsconfig.json tsconfig.dist.json ./
COPY alsoCopy.js ./

# Copy workspace packages
COPY agent/ ./agent/
COPY browser-emulator-builder/ ./browser-emulator-builder/
COPY browser-profiler/ ./browser-profiler/
COPY client/ ./client/
COPY commons/ ./commons/
COPY core/ ./core/
COPY double-agent/ ./double-agent/
COPY double-agent-stacks/ ./double-agent-stacks/
COPY end-to-end/ ./end-to-end/
COPY examples/ ./examples/
COPY interfaces/ ./interfaces/
COPY js-path/ ./js-path/
COPY net/ ./net/
COPY playground/ ./playground/
COPY plugin-utils/ ./plugin-utils/
COPY plugins/ ./plugins/
COPY real-user-agents/ ./real-user-agents/
COPY specification/ ./specification/
COPY testing/ ./testing/
COPY timetravel/ ./timetravel/

# Install dependencies
RUN yarn install --frozen-lockfile

# Build the distribution
RUN yarn build:dist

# Install production dependencies in build-dist
WORKDIR /app/build-dist
RUN yarn install --production --frozen-lockfile

# ============================================
# Production stage - minimal runtime image
# ============================================
FROM base AS production

# Copy built application from builder
COPY --from=builder /app/build-dist /app

# Copy server entry point
COPY docker-server.js /app/server.js

# Install Hono dependencies for the API server
RUN npm install --no-save hono @hono/node-server @hono/node-ws

# Create data directory for persistence
RUN mkdir -p /data && chown -R hero:hero /data /app

# Environment variables
ENV NODE_ENV=production
ENV ULX_DATA_DIR=/data
ENV ULX_NO_CHROME_SANDBOX=true
ENV ULX_DISABLE_GPU=true
ENV HERO_PORT=1337

# Switch to non-root user
USER hero

# Expose WebSocket API port
EXPOSE 1337

# Health check using HTTP endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.HERO_PORT || 1337) + '/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Start the Hero API server
CMD ["node", "server.js"]
