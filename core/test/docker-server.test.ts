import WebSocket = require('ws');
import { AddressInfo } from 'net';
import Core from '../index';
import { WsTransportToCore, ConnectionToCore } from '@ulixee/net';

// Import the docker-server module (will be at root after build)
const dockerServerPath = require.resolve('../../docker-server.js');

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
      expect(server.wsServer).toBeNull();
      expect(server.core).toBeNull();
      expect(server.connections).toBeInstanceOf(Set);
      expect(server.connections.size).toBe(0);
    });
  });

  describe('start()', () => {
    it('should start the server and return address info', async () => {
      server = new HeroApiServer('127.0.0.1', 0);
      const address = await server.start();

      expect(address).toBeDefined();
      expect(address.port).toBeGreaterThan(0);
      expect(address.address).toBe('127.0.0.1');
      expect(server.wsServer).not.toBeNull();
      expect(server.core).not.toBeNull();
    });

    it('should reject on server error', async () => {
      // Start a server on a specific port
      server = new HeroApiServer('127.0.0.1', 0);
      await server.start();
      const usedPort = (server.wsServer.address() as AddressInfo).port;

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

  describe('handleConnection()', () => {
    it('should handle client connections', async () => {
      server = new HeroApiServer('127.0.0.1', 0);
      const address = await server.start();

      const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);

      await new Promise<void>((resolve, reject) => {
        ws.on('open', () => {
          expect(server.connections.size).toBe(1);
          resolve();
        });
        ws.on('error', reject);
      });

      ws.close();

      // Wait for close event to propagate
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(server.connections.size).toBe(0);
    });

    it('should handle client errors', async () => {
      server = new HeroApiServer('127.0.0.1', 0);
      const address = await server.start();

      const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Simulate error event on server-side connection
      const clientWs = Array.from(server.wsServer.clients)[0] as WebSocket;
      expect(clientWs).toBeDefined();
      clientWs.emit('error', new Error('Test error'));

      // Connection should still exist (errors don't close the connection)
      expect(server.connections.size).toBe(1);

      ws.close();
      await new Promise(resolve => setTimeout(resolve, 100));
    });
  });

  describe('shutdown()', () => {
    it('should gracefully shutdown the server', async () => {
      server = new HeroApiServer('127.0.0.1', 0);
      await server.start();

      expect(server.wsServer).not.toBeNull();
      expect(server.core).not.toBeNull();

      await server.shutdown();

      // Server should be closed
      expect(server.connections.size).toBe(0);
    });

    it('should disconnect all clients on shutdown', async () => {
      server = new HeroApiServer('127.0.0.1', 0);
      const address = await server.start();

      // Connect a client
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);
      await new Promise<void>(resolve => {
        ws.on('open', resolve);
      });

      expect(server.connections.size).toBe(1);

      await server.shutdown();

      expect(server.connections.size).toBe(0);

      // Client should be disconnected
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    });

    it('should handle shutdown with no server running', async () => {
      server = new HeroApiServer('127.0.0.1', 0);
      // Don't start, just shutdown
      await expect(server.shutdown()).resolves.not.toThrow();
    });

    it('should handle disconnect errors gracefully', async () => {
      server = new HeroApiServer('127.0.0.1', 0);
      const address = await server.start();

      // Connect a client
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);
      await new Promise<void>(resolve => {
        ws.on('open', resolve);
      });

      // Mock a connection that throws on disconnect
      const mockConnection = {
        disconnect: jest.fn().mockRejectedValue(new Error('Disconnect error')),
      };
      server.connections.add(mockConnection);

      // Shutdown should not throw despite disconnect error
      await expect(server.shutdown()).resolves.not.toThrow();

      ws.close();
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

  describe('WebSocket transport integration', () => {
    it('should accept connections and respond to commands', async () => {
      server = new HeroApiServer('127.0.0.1', 0);
      const address = await server.start();

      const transport = new WsTransportToCore(`ws://127.0.0.1:${address.port}`);
      const connection = new ConnectionToCore(transport);

      // The connection should be established
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(server.connections.size).toBe(1);

      await connection.disconnect();
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
