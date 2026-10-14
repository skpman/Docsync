/**
 * End-to-end check against running api + sync servers:
 *   API_URL=http://localhost:4000 SYNC_URL=ws://localhost:4001 npm run test:e2e -w @docsync/sync
 * Uses real Yjs clients (the same y-websocket provider the browser uses).
 */
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

const API = process.env.API_URL ?? 'http://localhost:4000';
const SYNC = process.env.SYNC_URL ?? 'ws://localhost:4001';
const run = Date.now().toString(36);

async function call(path: string, token: string | null, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(API + path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const type = res.headers.get('content-type') ?? '';
  const body = type.includes('json') ? await res.json() : await res.arrayBuffer();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status} ${JSON.stringify(body)}`);
  return body as any;
}

const register = (name: string) =>
  call('/auth/register', null, {
    method: 'POST',
    body: { email: `${name.toLowerCase()}-${run}@example.com`, name, password: 'password123' },
  });

function connect(docId: string, token: string) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(SYNC, docId, doc, {
    params: { token },
    WebSocketPolyfill: WebSocket as any,
    disableBc: true,
  });
  const closes: number[] = [];
  provider.on('connection-close', (e: any) => {
    if (e) closes.push(e.code);
    if (e?.code >= 4400 && e?.code < 4500) provider.shouldConnect = false;
  });
  return { doc, provider, closes, text: () => doc.getXmlFragment('default').toString() };
}

async function until(cond: () => boolean, what: string, ms = 5000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

function setParagraph(doc: Y.Doc, text: string) {
  const frag = doc.getXmlFragment('default');
  doc.transact(() => {
    frag.delete(0, frag.length);
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText(text)]);
    frag.insert(0, [p]);
  });
}

function appendParagraph(doc: Y.Doc, text: string) {
  const frag = doc.getXmlFragment('default');
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(text)]);
  frag.push([p]);
}

const step = (name: string) => console.log(`✓ ${name}`);

const alice = await register('Alice');
const bob = await register('Bob');
const carol = await register('Carol');
const dave = await register('Dave');
step('registered 4 users');

const { document } = await call('/documents', alice.token, { method: 'POST', body: { title: 'Design notes' } });
await call(`/documents/${document.id}/permissions`, alice.token, { method: 'PUT', body: { email: bob.user.email, role: 'editor' } });
await call(`/documents/${document.id}/permissions`, alice.token, { method: 'PUT', body: { email: carol.user.email, role: 'viewer' } });
const bobDocs = await call('/documents', bob.token);
assert.equal(bobDocs.documents[0].role, 'editor');
await assert.rejects(call(`/documents/${document.id}`, dave.token), /404/);
await assert.rejects(
  call(`/documents/${document.id}/permissions`, bob.token, { method: 'PUT', body: { email: dave.user.email, role: 'editor' } }),
  /403/,
);
step('created document and shared it (editor + viewer); non-members and non-owners are refused');

const a = connect(document.id, alice.token);
const b = connect(document.id, bob.token);
await until(() => a.provider.synced && b.provider.synced, 'both clients synced');
setParagraph(a.doc, 'Hello from Alice');
await until(() => b.text().includes('Hello from Alice'), 'Bob receives Alice edit');
step('real-time: Bob sees Alice edit');

// Awareness: Alice tries to claim someone else's name; the server stamps her verified identity
a.provider.awareness.setLocalStateField('user', { name: 'Mallory', color: '#000' });
a.provider.awareness.setLocalStateField('cursor', { anchor: 1, head: 1 });
await until(
  () => [...b.provider.awareness.getStates().values()].some((s) => s.cursor && s.user?.id === alice.user.id),
  'Bob sees Alice cursor',
);
const aliceState = [...b.provider.awareness.getStates().values()].find((s) => s.user?.id === alice.user.id)!;
assert.equal(aliceState.user.name, 'Alice');
step('awareness: Bob sees Alice cursor, identity is server-verified (spoofed name rejected)');

// Offline editing: Bob drops off, both edit concurrently, Bob reconnects, both converge
b.provider.disconnect();
await until(() => !b.provider.wsconnected, 'Bob offline');
appendParagraph(b.doc, 'Bob wrote this offline');
appendParagraph(a.doc, 'Alice wrote this meanwhile');
await new Promise((r) => setTimeout(r, 300));
assert.ok(!a.text().includes('offline'), 'Alice should not see the offline edit yet');
b.provider.connect();
await until(() => a.text().includes('Bob wrote this offline') && b.text().includes('Alice wrote this meanwhile'), 'merge after reconnect');
assert.equal(a.text(), b.text());
step('offline: concurrent edits merged on reconnect, replicas identical');

// Viewer writes are dropped by the server
const c = connect(document.id, carol.token);
await until(() => c.provider.synced, 'Carol synced');
assert.equal(c.text(), a.text());
appendParagraph(c.doc, 'Carol should not be able to write this');
await new Promise((r) => setTimeout(r, 500));
assert.ok(!a.text().includes('Carol'), 'viewer edit must not reach others');
c.provider.destroy();
step('permissions: viewer can read but her writes are rejected');

// Non-member is refused with a close code
const d = connect(document.id, dave.token);
await until(() => d.closes.includes(4403), 'Dave refused with 4403');
d.provider.destroy();
step('permissions: non-member socket closed with 4403');

// Version history: snapshot, edit, restore
const v1Text = a.text();
const { version: v1 } = await call(`/documents/${document.id}/versions`, alice.token, { method: 'POST', body: { label: 'First draft' } });
appendParagraph(b.doc, 'A later paragraph to be undone by restore');
await until(() => a.text().includes('later paragraph'), 'later edit');
const content = new Uint8Array(await call(`/documents/${document.id}/versions/${v1}/content`, carol.token));
const preview = new Y.Doc();
Y.applyUpdate(preview, content);
assert.equal(preview.getXmlFragment('default').toString(), v1Text);
await call(`/documents/${document.id}/versions/${v1}/restore`, bob.token, { method: 'POST' });
await until(() => a.text() === v1Text && b.text() === v1Text, 'live clients see restored content');
const { versions } = await call(`/documents/${document.id}/versions`, alice.token);
assert.deepEqual(
  versions.map((v: any) => v.reason),
  ['pre-restore', 'manual'],
);
await assert.rejects(call(`/documents/${document.id}/versions/${v1}/restore`, carol.token, { method: 'POST' }), /403/);
step('versions: snapshot stored, previewed by a viewer, restored live for everyone (pre-restore copy kept)');

// Revoking access kicks a live connection
await call(`/documents/${document.id}/permissions/${bob.user.id}`, alice.token, { method: 'DELETE' });
await until(() => b.closes.includes(4403), 'Bob kicked after revoke');
step('permissions: revoking access disconnects the live session');

// Persistence: everyone leaves, room closes, state reloads from Postgres
a.provider.destroy();
b.provider.destroy();
await new Promise((r) => setTimeout(r, 6500));
const again = connect(document.id, alice.token);
await until(() => again.provider.synced, 'reconnect after room closed');
assert.equal(again.text(), v1Text);
again.provider.destroy();
step('persistence: document reloads from Postgres after the room is closed');

await call(`/documents/${document.id}`, alice.token, { method: 'DELETE' });
await assert.rejects(call(`/documents/${document.id}`, alice.token), /404/);
step('owner deleted the document');

console.log('\nAll end-to-end checks passed');
process.exit(0);
