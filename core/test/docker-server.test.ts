import WebSocket = require('ws');
import * as http from 'http';
import Core from '../index';
import { WsTransportToCore, ConnectionToCore } from '@ulixee/net';

// Import the docker-server module (will be at root after build)
const dockerServerPath = require.resolve('../../docker-server.js');

// Helper to make HTTP requests
function httpRequest(
  options: http.RequestOptions,
  body?: string,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode!, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('HeroApiServer', () => {
  let HeroApiServer: any;
  let server: any;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    // Clear require cache to ensure fresh import
    delete require.cache[dockerServerPath];
    const dockerServer = require(dockerServerPath);
    HeroApiServer = dockerServer.HeroApiServer;
    originalEnv = { ...process.env };
  });

  afterEach(async () => {
    // Restore environment variables
    process.env = { ...originalEnv };

    // Cleanup server if still running
    if (server) {
      try {
        await server.shutdown();
      } catch (e) {
        // Ignore shutdown errors in cleanup
      }
      server = null;
    }

    // Ensure Core is shutdown
    try {
      await Core.shutdown();
    } catch (e) {
      // Ignore if already shutdown
    }
  });

  afterAll(async () => {
    await Core.shutdown();
  });

  describe('constructor', () => {
    it('should initialize with host and port', () => {
      server = new HeroApiServer('localhost', 0);
      expect(server.host).toBe('localhost');
      expect(server.port).toBe(0);
      expect(server.server).toBeNull();
      expect(server.core).toBeNull();
      expect(server.wsConnections).toBeInstanceOf(Set);
      expect(server.wsConnections.size).toBe(0);
      expect(server.sessions).toBeInstanceOf(Map);
      expect(server.sessions.size).toBe(0);
      expect(server.app).toBeDefined();
    });
  });

  describe('start()', () => {
    it('should start the server and return address info', async () => {
      server = new HeroApiServer('127.0.0.1', 0);
      const info = await server.start();

      expect(info).toBeDefined();
      expect(info.port).toBeGreaterThan(0);
      expect(server.server).not.toBeNull();
      expect(server.core).not.toBeNull();
    });

    it('should reject on server error', async () => {
      // Start a server on a specific port
      server = new HeroApiServer('127.0.0.1', 0);
      const info = await server.start();
      const usedPort = info.port;

      // Try to start another server on the same port
      const server2 = new HeroApiServer('127.0.0.1', usedPort);

      await expect(server2.start()).rejects.toThrow();

      // Cleanup the second server's core if it started
      try {
        await Core.shutdown();
      } catch (e) {
        // Ignore
      }
    });
  });

  describe('HTTP API endpoints', () => {
    let port: number;

    beforeEach(async () => {
      server = new HeroApiServer('127.0.0.1', 0);
      const info = await server.start();
      port = info.port;
    });

    it('GET / should return server info', async () => {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/',
        method: 'GET',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.name).toBe('Hero API Server');
      expect(body.status).toBe('running');
      expect(body.endpoints).toBeDefined();
    });

    it('GET /health should return health status', async () => {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/health',
        method: 'GET',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.status).toBe('healthy');
      expect(body.uptime).toBeGreaterThanOrEqual(0);
      expect(body.memory).toBeDefined();
      expect(typeof body.sessions).toBe('number');
      expect(typeof body.wsConnections).toBe('number');
    });

    it('GET /api/info should return detailed info', async () => {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/api/info',
        method: 'GET',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.name).toBe('Hero API Server');
      expect(body.nodeVersion).toContain('v');
      expect(body.platform).toBeDefined();
    });

    it('GET /api/sessions should return empty list initially', async () => {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/api/sessions',
        method: 'GET',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.sessions).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('POST /api/sessions should create a session', async () => {
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/sessions',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        JSON.stringify({ viewport: { width: 1920, height: 1080 } }),
      );

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.session).toBeDefined();
      expect(body.session.id).toContain('session-');
      expect(body.wsUrl).toContain('/ws?sessionId=');
    });

    it('GET /api/sessions/:id should return session details', async () => {
      // Create a session first
      const createRes = await httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/sessions',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        '{}',
      );
      const { session } = JSON.parse(createRes.body);

      // Get session details
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: `/api/sessions/${session.id}`,
        method: 'GET',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.session.id).toBe(session.id);
    });

    it('GET /api/sessions/:id should return 404 for non-existent session', async () => {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: '/api/sessions/non-existent',
        method: 'GET',
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Session not found');
    });

    it('DELETE /api/sessions/:id should delete a session', async () => {
      // Create a session first
      const createRes = await httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/sessions',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        '{}',
      );
      const { session } = JSON.parse(createRes.body);

      // Delete the session
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: `/api/sessions/${session.id}`,
        method: 'DELETE',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);

      // Verify it's deleted
      const getRes = await httpRequest({
        hostname: '127.0.0.1',
        port,
        path: `/api/sessions/${session.id}`,
        method: 'GET',
      });
      expect(getRes.statusCode).toBe(404);
    });

    it('POST /api/scrape should return hint message', async () => {
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/scrape',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        JSON.stringify({ url: 'https://example.com', selector: '.content' }),
      );

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.message).toContain('WebSocket');
      expect(body.requestedUrl).toBe('https://example.com');
    });

    it('POST /api/scrape should require URL', async () => {
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/scrape',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        '{}',
      );

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('URL is required');
    });
  });

  describe('shutdown()', () => {
    it('should gracefully shutdown the server', async () => {
      server = new HeroApiServer('127.0.0.1', 0);
      await server.start();

      expect(server.server).not.toBeNull();
      expect(server.core).not.toBeNull();

      await server.shutdown();

      expect(server.wsConnections.size).toBe(0);
      expect(server.sessions.size).toBe(0);
    });

    it('should handle shutdown with no server running', async () => {
      server = new HeroApiServer('127.0.0.1', 0);
      // Don't start, just shutdown
      await expect(server.shutdown()).resolves.not.toThrow();
    });

    it('should handle disconnect errors gracefully', async () => {
      server = new HeroApiServer('127.0.0.1', 0);
      await server.start();

      // Mock a connection that throws on disconnect
      const mockConnection = {
        disconnect: jest.fn().mockRejectedValue(new Error('Disconnect error')),
      };
      server.wsConnections.add(mockConnection);

      // Shutdown should not throw despite disconnect error
      await expect(server.shutdown()).resolves.not.toThrow();
    });
  });

  describe('environment variables', () => {
    it('should use default PORT and HOST', () => {
      delete require.cache[dockerServerPath];
      delete process.env.HERO_PORT;
      delete process.env.HERO_HOST;

      const { PORT, HOST } = require(dockerServerPath);

      expect(PORT).toBe(1337);
      expect(HOST).toBe('0.0.0.0');
    });

    it('should use custom PORT and HOST from environment', () => {
      delete require.cache[dockerServerPath];
      process.env.HERO_PORT = '9999';
      process.env.HERO_HOST = '192.168.1.1';

      const { PORT, HOST } = require(dockerServerPath);

      expect(PORT).toBe(9999);
      expect(HOST).toBe('192.168.1.1');
    });
  });

  describe('WebSocket endpoint', () => {
    it('should accept WebSocket connections on /ws', async () => {
      server = new HeroApiServer('127.0.0.1', 0);
      const info = await server.start();

      const ws = new WebSocket(`ws://127.0.0.1:${info.port}/ws`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          // Give time for connection to be registered
          setTimeout(() => {
            expect(server.wsConnections.size).toBe(1);
            resolve();
          }, 100);
        });
        ws.on('error', reject);
      });

      ws.close();
      await new Promise(resolve => setTimeout(resolve, 100));
    });
  });
});

describe('docker-server module exports', () => {
  it('should export HeroApiServer class', () => {
    const { HeroApiServer } = require(dockerServerPath);
    expect(HeroApiServer).toBeDefined();
    expect(typeof HeroApiServer).toBe('function');
  });

  it('should export main function', () => {
    const { main } = require(dockerServerPath);
    expect(main).toBeDefined();
    expect(typeof main).toBe('function');
  });

  it('should export PORT and HOST constants', () => {
    const { PORT, HOST } = require(dockerServerPath);
    expect(typeof PORT).toBe('number');
    expect(typeof HOST).toBe('string');
  });
});
