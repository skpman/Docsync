import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { config, getRole, migrate, pool, snapshotStore, UUID_RE, verifyToken } from '@docsync/common';
import { readSnapshot } from './persistence.js';
import { closeAllRooms, discardRoom, getRoom, peekRoom, withRoom } from './rooms.js';

const PING_INTERVAL_MS = 30_000;

// ---- internal HTTP API (called by the backend API, protected by a shared secret) -------------

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString('utf8');
  return body ? JSON.parse(body) : {};
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') return json(res, 200, { ok: true });

  const match = url.pathname.match(/^\/internal\/docs\/([^/]+)\/(snapshot|restore|revalidate|close)$/);
  if (!match || req.method !== 'POST') return json(res, 404, { error: 'Not found' });
  if (req.headers['x-internal-secret'] !== config.internalSecret) return json(res, 401, { error: 'Unauthorized' });

  const [, docId, action] = match;
  if (!UUID_RE.test(docId)) return json(res, 400, { error: 'Bad document id' });

  try {
    const body = await readJson(req);
    switch (action) {
      case 'snapshot': {
        const version = await withRoom(docId, (room) =>
          room.snapshot('manual', body.userId ?? null, body.label ?? null),
        );
        return json(res, 200, { version });
      }
      case 'restore': {
        const version = Number(body.version);
        const state = await readSnapshot(docId, version);
        if (!state) return json(res, 404, { error: 'Version not found' });
        await withRoom(docId, (room) => room.restoreFrom(state, version, body.userId));
        return json(res, 200, { restored: version });
      }
      case 'revalidate': {
        // Permissions changed: update roles of live connections and kick anyone who lost access
        const pending = peekRoom(docId);
        if (pending) {
          const room = await pending;
          for (const conn of [...room.conns.values()]) {
            const role = await getRole(docId, conn.user.id);
            if (!role) conn.ws.close(4403, 'Access revoked');
            else room.setRole(conn.ws, role);
          }
        }
        return json(res, 200, { ok: true });
      }
      case 'close':
        await discardRoom(docId);
        return json(res, 200, { ok: true });
    }
  } catch (err) {
    console.error(`internal ${action} failed`, err);
    return json(res, 500, { error: 'Internal error' });
  }
});

// ---- WebSocket sync endpoint: ws://host/<docId>?token=<jwt> ---------------------------------

const wss = new WebSocketServer({ noServer: true });
const alive = new WeakMap<WebSocket, boolean>();

server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // Accept both /<docId> and /sync/<docId> so it works behind a path-prefixing proxy
  const docId = url.pathname.split('/').filter(Boolean).pop() ?? '';
  const user = verifyToken(url.searchParams.get('token') ?? '');

  // Failures are reported as WebSocket close codes (not HTTP errors) so the client can tell
  // "access denied" apart from "network down" and stop reconnecting.
  const reject = (code: number, reason: string) =>
    wss.handleUpgrade(req, socket, head, (ws) => ws.close(code, reason));
  if (!user) return reject(4401, 'Unauthorized');
  if (!UUID_RE.test(docId)) return reject(4404, 'Not found');

  let role;
  try {
    role = await getRole(docId, user.sub);
  } catch (err) {
    console.error('permission check failed', err);
    return reject(1011, 'Internal error');
  }
  if (!role) return reject(4403, 'Forbidden');

  wss.handleUpgrade(req, socket, head, async (ws) => {
    ws.binaryType = 'arraybuffer';
    // Buffer messages that arrive while the room loads from Postgres
    const queue: Uint8Array[] = [];
    let room: Awaited<ReturnType<typeof getRoom>> | null = null;
    ws.on('message', (data: ArrayBuffer) => {
      const msg = new Uint8Array(data);
      if (room) room.handleMessage(ws, msg);
      else queue.push(msg);
    });
    ws.on('close', () => room?.removeConnection(ws));
    alive.set(ws, true);
    ws.on('pong', () => alive.set(ws, true));

    try {
      const loaded = await getRoom(docId);
      if (ws.readyState !== ws.OPEN) return;
      room = loaded;
      room.addConnection(ws, { id: user.sub, name: user.name, color: user.color }, role);
      for (const msg of queue.splice(0)) room.handleMessage(ws, msg);
    } catch (err) {
      console.error('failed to open room', err);
      ws.close(1011, 'Failed to load document');
    }
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.get(ws)) {
      ws.terminate();
      continue;
    }
    alive.set(ws, false);
    ws.ping();
  }
}, PING_INTERVAL_MS);

// ---- lifecycle ------------------------------------------------------------------------------

await migrate();
await snapshotStore.init();
server.listen(config.syncPort, () => console.log(`DocSync sync server listening on :${config.syncPort}`));

async function shutdown() {
  console.log('Shutting down, flushing open documents...');
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.close(1012, 'Server restarting');
  server.close();
  await closeAllRooms();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
