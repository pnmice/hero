# Hero API Server Documentation

The Hero API Server provides a REST API and WebSocket interface for controlling Hero browser instances remotely.

## Base URL

```
http://localhost:1337
```

## Authentication

Currently, no authentication is required. For production deployments, use a reverse proxy (nginx, traefik) with authentication.

---

## Endpoints

### Health & Info

#### GET /
Returns server information and available endpoints.

**Response:**
```json
{
  "name": "Hero API Server",
  "version": "2.0.0-alpha.34",
  "status": "running",
  "endpoints": {
    "health": "GET /health",
    "sessions": "GET /api/sessions",
    "createSession": "POST /api/sessions",
    "websocket": "GET /ws"
  }
}
```

#### GET /health
Health check endpoint for monitoring and container orchestration.

**Response:**
```json
{
  "status": "healthy",
  "uptime": 3600.5,
  "memory": {
    "rss": 52428800,
    "heapTotal": 20971520,
    "heapUsed": 15728640,
    "external": 1048576
  },
  "sessions": 2,
  "wsConnections": 1
}
```

#### GET /api/info
Returns detailed server information.

**Response:**
```json
{
  "name": "Hero API Server",
  "version": "2.0.0-alpha.34",
  "nodeVersion": "v18.19.0",
  "platform": "linux",
  "arch": "x64",
  "dataDir": "/data"
}
```

---

### Session Management

#### GET /api/sessions
List all active sessions.

**Response:**
```json
{
  "sessions": [
    {
      "id": "session-1706745600000-abc123def",
      "createdAt": "2024-02-01T00:00:00.000Z",
      "status": "created"
    }
  ],
  "total": 1
}
```

#### POST /api/sessions
Create a new browser session.

**Request Body:**
```json
{
  "userAgent": "optional custom user agent",
  "viewport": {
    "width": 1920,
    "height": 1080
  },
  "locale": "en-US"
}
```

**Response:**
```json
{
  "success": true,
  "session": {
    "id": "session-1706745600000-abc123def",
    "createdAt": "2024-02-01T00:00:00.000Z",
    "status": "created",
    "options": {}
  },
  "message": "Session created. Connect via WebSocket to control it.",
  "wsUrl": "/ws?sessionId=session-1706745600000-abc123def"
}
```

#### GET /api/sessions/:id
Get details of a specific session.

**Response:**
```json
{
  "session": {
    "id": "session-1706745600000-abc123def",
    "createdAt": "2024-02-01T00:00:00.000Z",
    "status": "created",
    "options": {}
  }
}
```

**Error Response (404):**
```json
{
  "error": "Session not found"
}
```

#### DELETE /api/sessions/:id
Delete a session.

**Response:**
```json
{
  "success": true,
  "message": "Session session-1706745600000-abc123def deleted"
}
```

---

### Quick Operations (Hints)

These endpoints provide guidance for using the full capabilities via WebSocket.

#### POST /api/scrape
Request a scrape operation.

**Request Body:**
```json
{
  "url": "https://example.com",
  "selector": ".content",
  "waitFor": "networkIdle",
  "timeout": 30000
}
```

**Response:**
```json
{
  "success": true,
  "message": "Use WebSocket connection for full scraping capabilities",
  "hint": "POST to /api/sessions to create a session, then connect via /ws",
  "requestedUrl": "https://example.com",
  "selector": ".content",
  "waitFor": "networkIdle",
  "timeout": 30000
}
```

#### POST /api/screenshot
Request a screenshot operation.

**Request Body:**
```json
{
  "url": "https://example.com",
  "fullPage": true,
  "format": "png"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Use WebSocket connection for screenshot capabilities",
  "hint": "Connect via /ws to take screenshots",
  "requestedUrl": "https://example.com",
  "fullPage": true,
  "format": "png"
}
```

---

## WebSocket API

### Connection

Connect to the WebSocket endpoint for real-time browser control:

```
ws://localhost:1337/ws
```

Or with a session ID:
```
ws://localhost:1337/ws?sessionId=session-xxx
```

### Using with Hero Client

```javascript
const Hero = require('@ulixee/hero');

const hero = new Hero({
  connectionToCore: 'ws://localhost:1337/ws'
});

await hero.goto('https://example.com');
const title = await hero.document.title;
console.log(title);

await hero.close();
```

### WebSocket Protocol

The WebSocket connection uses the Hero Core protocol for bidirectional communication. Messages are JSON-encoded and follow the Hero command/response pattern.

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message description",
  "code": "ERROR_CODE"
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INTERNAL_ERROR` | 500 | Server internal error |
| `NOT_FOUND` | 404 | Resource not found |
| `BAD_REQUEST` | 400 | Invalid request parameters |

---

## Docker Deployment

### Using Docker Compose

```bash
# Start the server
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the server
docker-compose down
```

### Using Docker directly

```bash
# Build the image
docker build -t hero-api .

# Run the container
docker run -d \
  --name hero-api \
  -p 1337:1337 \
  -v hero-data:/data \
  -v /dev/shm:/dev/shm \
  --shm-size=2g \
  --security-opt seccomp=unconfined \
  hero-api
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HERO_PORT` | `1337` | API server port |
| `HERO_HOST` | `0.0.0.0` | API server host |
| `ULX_DATA_DIR` | `/data` | Data directory for sessions |
| `ULX_NO_CHROME_SANDBOX` | `true` | Disable Chrome sandbox (required in Docker) |
| `ULX_DISABLE_GPU` | `true` | Disable GPU acceleration |
| `ULX_DISABLE_MITM` | - | Disable MITM proxy |
| `ULX_SHOW_CHROME` | - | Show Chrome window (debugging) |

---

## Examples

### cURL Examples

```bash
# Health check
curl http://localhost:1337/health

# Get server info
curl http://localhost:1337/api/info

# List sessions
curl http://localhost:1337/api/sessions

# Create a session
curl -X POST http://localhost:1337/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"viewport": {"width": 1920, "height": 1080}}'

# Delete a session
curl -X DELETE http://localhost:1337/api/sessions/session-xxx
```

### JavaScript/Node.js Example

```javascript
const Hero = require('@ulixee/hero');

async function scrapeExample() {
  const hero = new Hero({
    connectionToCore: 'ws://localhost:1337/ws'
  });

  try {
    await hero.goto('https://example.com');
    await hero.waitForPaintingStable();

    const title = await hero.document.title;
    const content = await hero.document.querySelector('h1').textContent;

    console.log('Title:', title);
    console.log('Content:', content);
  } finally {
    await hero.close();
  }
}

scrapeExample().catch(console.error);
```

### Python Example (using websockets)

```python
import asyncio
import websockets
import json

async def connect_to_hero():
    uri = "ws://localhost:1337/ws"
    async with websockets.connect(uri) as ws:
        # Send commands to Hero
        command = {
            "command": "Session.create",
            "args": [{}]
        }
        await ws.send(json.dumps(command))
        response = await ws.recv()
        print(f"Response: {response}")

asyncio.run(connect_to_hero())
```
