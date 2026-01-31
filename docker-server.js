/**
 * Hero API Server Entry Point for Docker
 *
 * This is a REST + WebSocket API server that exposes Hero Core functionality.
 * It uses Hono for HTTP routing and supports WebSocket for real-time control.
 */

const { Hono } = require('hono');
const { serve } = require('@hono/node-server');
const { createNodeWebSocket } = require('@hono/node-ws');
const Core = require('@ulixee/hero-core').default;
const { WsTransportToClient } = require('@ulixee/net');
const ShutdownHandler = require('@ulixee/commons/lib/ShutdownHandler').default;

const PORT = parseInt(process.env.HERO_PORT || '1337', 10);
const HOST = process.env.HERO_HOST || '0.0.0.0';

class HeroApiServer {
  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.server = null;
    this.core = null;
    this.sessions = new Map();
    this.wsConnections = new Set();
    this.app = this.createApp();
  }

  createApp() {
    const app = new Hono();

    // Middleware: Request logging
    app.use('*', async (c, next) => {
      const start = Date.now();
      await next();
      const ms = Date.now() - start;
      console.log(`${c.req.method} ${c.req.path} - ${c.res.status} (${ms}ms)`);
    });

    // Middleware: Error handling
    app.onError((err, c) => {
      console.error('Request error:', err);
      return c.json({
        error: err.message,
        code: err.code || 'INTERNAL_ERROR',
      }, 500);
    });

    // ============================================
    // Health & Info Endpoints
    // ============================================

    app.get('/', (c) => {
      return c.json({
        name: 'Hero API Server',
        version: '2.0.0-alpha.34',
        status: 'running',
        endpoints: {
          health: 'GET /health',
          sessions: 'GET /api/sessions',
          createSession: 'POST /api/sessions',
          websocket: 'GET /ws',
        },
      });
    });

    app.get('/health', (c) => {
      return c.json({
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        sessions: this.sessions.size,
        wsConnections: this.wsConnections.size,
      });
    });

    app.get('/api/info', (c) => {
      return c.json({
        name: 'Hero API Server',
        version: '2.0.0-alpha.34',
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        dataDir: process.env.ULX_DATA_DIR || 'default',
      });
    });

    // ============================================
    // Session Management Endpoints
    // ============================================

    app.get('/api/sessions', (c) => {
      const sessions = Array.from(this.sessions.entries()).map(([id, session]) => ({
        id,
        createdAt: session.createdAt,
        status: session.status,
      }));
      return c.json({ sessions, total: sessions.length });
    });

    app.post('/api/sessions', async (c) => {
      try {
        const body = await c.req.json().catch(() => ({}));
        const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const sessionInfo = {
          id: sessionId,
          createdAt: new Date().toISOString(),
          status: 'created',
          options: body,
        };

        this.sessions.set(sessionId, sessionInfo);

        return c.json({
          success: true,
          session: sessionInfo,
          message: 'Session created. Connect via WebSocket to control it.',
          wsUrl: `/ws?sessionId=${sessionId}`,
        }, 201);
      } catch (error) {
        return c.json({ error: error.message }, 400);
      }
    });

    app.get('/api/sessions/:id', (c) => {
      const sessionId = c.req.param('id');
      const session = this.sessions.get(sessionId);

      if (!session) {
        return c.json({ error: 'Session not found' }, 404);
      }

      return c.json({ session });
    });

    app.delete('/api/sessions/:id', async (c) => {
      const sessionId = c.req.param('id');
      const session = this.sessions.get(sessionId);

      if (!session) {
        return c.json({ error: 'Session not found' }, 404);
      }

      this.sessions.delete(sessionId);

      return c.json({
        success: true,
        message: `Session ${sessionId} deleted`,
      });
    });

    // ============================================
    // Quick Scraping Endpoints (Stateless)
    // ============================================

    app.post('/api/scrape', async (c) => {
      try {
        const body = await c.req.json();
        const { url, selector, waitFor, timeout = 30000 } = body;

        if (!url) {
          return c.json({ error: 'URL is required' }, 400);
        }

        // This is a simplified example - real implementation would use Hero
        return c.json({
          success: true,
          message: 'Use WebSocket connection for full scraping capabilities',
          hint: 'POST to /api/sessions to create a session, then connect via /ws',
          requestedUrl: url,
          selector,
          waitFor,
          timeout,
        });
      } catch (error) {
        return c.json({ error: error.message }, 400);
      }
    });

    app.post('/api/screenshot', async (c) => {
      try {
        const body = await c.req.json();
        const { url, fullPage = false, format = 'png' } = body;

        if (!url) {
          return c.json({ error: 'URL is required' }, 400);
        }

        return c.json({
          success: true,
          message: 'Use WebSocket connection for screenshot capabilities',
          hint: 'Connect via /ws to take screenshots',
          requestedUrl: url,
          fullPage,
          format,
        });
      } catch (error) {
        return c.json({ error: error.message }, 400);
      }
    });

    return app;
  }

  async start() {
    console.log('Initializing Hero Core...');
    this.core = await Core.start();

    const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: this.app });

    // WebSocket endpoint for real-time control
    this.app.get('/ws', upgradeWebSocket((c) => {
      return {
        onOpen: (evt, ws) => {
          console.log('WebSocket client connected');
          const transport = new WsTransportToClient(ws.raw, { socket: { remoteAddress: 'unknown' } });
          const connection = this.core.addConnection(transport);
          this.wsConnections.add(connection);

          ws._heroConnection = connection;
        },
        onMessage: (evt, ws) => {
          // Messages are handled by the transport
        },
        onClose: (evt, ws) => {
          console.log('WebSocket client disconnected');
          if (ws._heroConnection) {
            this.wsConnections.delete(ws._heroConnection);
          }
        },
        onError: (evt, ws) => {
          console.error('WebSocket error:', evt);
        },
      };
    }));

    return new Promise((resolve, reject) => {
      try {
        this.server = serve({
          fetch: this.app.fetch,
          port: this.port,
          hostname: this.host,
        }, (info) => {
          injectWebSocket(this.server);
          console.log(`Hero API Server listening on ${info.address}:${info.port}`);
          resolve(info);
        });

        this.server.on('error', (error) => {
          console.error('Server error:', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async shutdown() {
    console.log('Shutting down Hero API Server...');

    // Disconnect all WebSocket connections
    for (const connection of this.wsConnections) {
      try {
        await connection.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
    }
    this.wsConnections.clear();
    this.sessions.clear();

    // Close HTTP server
    if (this.server) {
      await new Promise((resolve) => {
        this.server.close(resolve);
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
    console.log(`REST API: http://${HOST}:${PORT}`);
    console.log(`WebSocket: ws://${HOST}:${PORT}/ws`);
    console.log(`Data directory: ${process.env.ULX_DATA_DIR || 'default'}`);
  } catch (error) {
    console.error('Failed to start Hero API Server:', error);
    process.exit(1);
  }
}

// Export for testing
module.exports = { HeroApiServer, main, PORT, HOST };

// Run main() only when this file is the entry point
if (require.main === module) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}
