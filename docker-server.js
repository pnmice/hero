/**
 * Hero API Server Entry Point for Docker
 *
 * This is a WebSocket-based API server that exposes Hero Core functionality.
 * Clients can connect via WebSocket to control Hero browser instances.
 */

const WebSocket = require('ws');
const Core = require('@ulixee/hero-core').default;
const { WsTransportToClient } = require('@ulixee/net');
const ShutdownHandler = require('@ulixee/commons/lib/ShutdownHandler').default;

const PORT = parseInt(process.env.HERO_PORT || '1337', 10);
const HOST = process.env.HERO_HOST || '0.0.0.0';

class HeroApiServer {
  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.wsServer = null;
    this.core = null;
    this.connections = new Set();
  }

  async start() {
    // Initialize Hero Core
    console.log('Initializing Hero Core...');
    this.core = await Core.start();

    // Create WebSocket server
    return new Promise((resolve, reject) => {
      this.wsServer = new WebSocket.Server({
        host: this.host,
        port: this.port
      }, () => {
        const address = this.wsServer.address();
        console.log(`Hero API Server listening on ${address.address}:${address.port}`);
        resolve(address);
      });

      this.wsServer.on('error', (error) => {
        console.error('WebSocket server error:', error);
        reject(error);
      });

      this.wsServer.on('connection', this.handleConnection.bind(this));
    });
  }

  handleConnection(ws, req) {
    const clientAddress = req.socket.remoteAddress;
    console.log(`Client connected from ${clientAddress}`);

    const transport = new WsTransportToClient(ws, req);
    const connection = this.core.addConnection(transport);
    this.connections.add(connection);

    ws.on('close', () => {
      console.log(`Client disconnected from ${clientAddress}`);
      this.connections.delete(connection);
    });

    ws.on('error', (error) => {
      console.error(`Client error from ${clientAddress}:`, error.message);
    });
  }

  async shutdown() {
    console.log('Shutting down Hero API Server...');

    // Disconnect all clients
    for (const connection of this.connections) {
      try {
        await connection.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
    }
    this.connections.clear();

    // Close WebSocket server
    if (this.wsServer) {
      await new Promise((resolve) => {
        this.wsServer.close(resolve);
      });
    }

    // Shutdown Hero Core
    await Core.shutdown();
    console.log('Hero API Server shutdown complete');
  }
}

// Main entry point
async function main() {
  const server = new HeroApiServer(HOST, PORT);

  // Register shutdown handlers
  ShutdownHandler.register(() => server.shutdown());

  // Handle process signals
  const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'];
  signals.forEach((signal) => {
    process.on(signal, async () => {
      console.log(`Received ${signal}, initiating shutdown...`);
      await server.shutdown();
      process.exit(0);
    });
  });

  try {
    await server.start();
    console.log('Hero API Server is ready to accept connections');
    console.log(`Data directory: ${process.env.ULX_DATA_DIR || 'default'}`);
  } catch (error) {
    console.error('Failed to start Hero API Server:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
