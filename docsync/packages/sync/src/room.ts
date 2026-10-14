import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import type { WebSocket } from 'ws';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { config, type Role } from '@docsync/common';
import { loadState, saveState, writeSnapshot, type SnapshotReason } from './persistence.js';
import {
  EDITOR_FIELD,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  SYNC_STEP1,
  stampAwarenessIdentity,
  type VerifiedUser,
} from './protocol.js';

export interface Connection {
  ws: WebSocket;
  user: VerifiedUser;
  role: Role;
  /** Awareness client ids this connection controls, removed when it disconnects. */
  awarenessIds: Set<number>;
}

const log = (docId: string, ...args: unknown[]) => console.log(`[room ${docId.slice(0, 8)}]`, ...args);

/**
 * One live document: the authoritative in-memory Y.Doc, its Awareness, and the connected clients.
 * Every update a client sends is merged into the doc (CRDT, no locks) and relayed to everyone else.
 */
export class Room {
  readonly doc = new Y.Doc({ gc: true });
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly conns = new Map<WebSocket, Connection>();
  /** Holders besides connections (e.g. an internal API call working on the doc). */
  private leases = 0;

  private persistTimer: NodeJS.Timeout | null = null;
  private firstUnpersistedAt = 0;
  private dirtySinceSnapshot = false;
  private snapshotTimer: NodeJS.Timeout;
  private persisting: Promise<void> = Promise.resolve();

  constructor(
    readonly id: string,
    private onEmpty: (room: Room) => void,
  ) {
    // Server-side awareness has no local state of its own
    this.awareness.setLocalState(null);

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcast(encoding.toUint8Array(encoder));
      if (origin !== 'persistence') this.markDirty();
    });

    this.awareness.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const conn = this.conns.get(origin as WebSocket);
        if (conn) {
          added.forEach((id) => conn.awarenessIds.add(id));
          removed.forEach((id) => conn.awarenessIds.delete(id));
        }
        const changed = added.concat(updated, removed);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
        this.broadcast(encoding.toUint8Array(encoder));
      },
    );

    this.snapshotTimer = setInterval(() => {
      if (this.dirtySinceSnapshot) this.snapshot('auto').catch((e) => log(this.id, 'auto snapshot failed', e));
    }, config.snapshotIntervalMs);
  }

  async load() {
    await loadState(this.id, this.doc);
  }

  get refCount() {
    return this.conns.size + this.leases;
  }

  lease(): () => void {
    this.leases++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.leases--;
      if (this.refCount === 0) this.onEmpty(this);
    };
  }

  // ---- connections ------------------------------------------------------------------------

  addConnection(ws: WebSocket, user: VerifiedUser, role: Role) {
    const conn: Connection = { ws, user, role, awarenessIds: new Set() };
    this.conns.set(ws, conn);

    // Start the sync handshake: send our state vector, client replies with what we're missing
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.send(ws, encoding.toUint8Array(encoder));

    this.sendAwarenessSnapshot(ws);
    log(this.id, `+ ${user.name} (${role}), ${this.conns.size} connected`);
  }

  removeConnection(ws: WebSocket) {
    const conn = this.conns.get(ws);
    if (!conn) return;
    this.conns.delete(ws);
    awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(conn.awarenessIds), null);
    log(this.id, `- ${conn.user.name}, ${this.conns.size} connected`);
    if (this.refCount === 0) this.onEmpty(this);
  }

  handleMessage(ws: WebSocket, data: Uint8Array) {
    const conn = this.conns.get(ws);
    if (!conn) return;
    try {
      const decoder = decoding.createDecoder(data);
      const type = decoding.readVarUint(decoder);
      switch (type) {
        case MESSAGE_SYNC: {
          // Viewers may request the document (step 1) but their writes are dropped
          if (conn.role === 'viewer' && decoding.peekVarUint(decoder) !== SYNC_STEP1) return;
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, this.doc, ws);
          if (encoding.length(encoder) > 1) this.send(ws, encoding.toUint8Array(encoder));
          break;
        }
        case MESSAGE_AWARENESS: {
          const update = stampAwarenessIdentity(decoding.readVarUint8Array(decoder), conn.user);
          awarenessProtocol.applyAwarenessUpdate(this.awareness, update, ws);
          break;
        }
        case MESSAGE_QUERY_AWARENESS:
          this.sendAwarenessSnapshot(ws);
          break;
      }
    } catch (err) {
      log(this.id, 'bad message from', conn.user.name, err);
    }
  }

  setRole(ws: WebSocket, role: Role) {
    const conn = this.conns.get(ws);
    if (conn) conn.role = role;
  }

  // ---- persistence & version history --------------------------------------------------------

  private markDirty() {
    this.dirtySinceSnapshot = true;
    const now = Date.now();
    if (!this.firstUnpersistedAt) this.firstUnpersistedAt = now;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    // Debounce writes, but never let unsaved changes sit longer than persistMaxWaitMs
    const wait = Math.max(0, Math.min(config.persistDebounceMs, this.firstUnpersistedAt + config.persistMaxWaitMs - now));
    this.persistTimer = setTimeout(() => void this.flush(), wait);
  }

  /** Writes the current state to Postgres now. Calls are chained so writes never interleave. */
  flush(): Promise<void> {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    this.firstUnpersistedAt = 0;
    this.persisting = this.persisting
      .then(() => saveState(this.id, this.doc))
      .catch((err) => log(this.id, 'persist failed', err));
    return this.persisting;
  }

  async snapshot(reason: SnapshotReason, userId: string | null = null, label: string | null = null) {
    this.dirtySinceSnapshot = false;
    await this.flush();
    try {
      const version = await writeSnapshot(this.id, this.doc, reason, userId, label);
      log(this.id, `snapshot v${version} (${reason})`);
      return version;
    } catch (err) {
      this.dirtySinceSnapshot = true;
      throw err;
    }
  }

  /**
   * Restores an older version by replacing the editor content with the snapshot's content as a
   * new CRDT change. History is preserved (nothing is rewound) and connected clients converge
   * on the restored content like any other edit.
   */
  async restoreFrom(snapshotState: Uint8Array, version: number, userId: string) {
    await this.snapshot('pre-restore', userId, `Before restoring v${version}`);
    const source = new Y.Doc();
    Y.applyUpdate(source, snapshotState);
    const from = source.getXmlFragment(EDITOR_FIELD);
    const to = this.doc.getXmlFragment(EDITOR_FIELD);
    this.doc.transact(() => {
      to.delete(0, to.length);
      to.insert(
        0,
        from.toArray().map((node) => (node as Y.XmlElement | Y.XmlText).clone()),
      );
    }, 'restore');
    source.destroy();
    await this.flush();
  }

  async close() {
    clearInterval(this.snapshotTimer);
    await this.flush();
    if (this.dirtySinceSnapshot) await this.snapshot('close').catch((e) => log(this.id, 'close snapshot failed', e));
    this.awareness.destroy();
    this.doc.destroy();
  }

  /** Drops the room without saving (used when the document was deleted). */
  discard(code: number, reason: string) {
    clearInterval(this.snapshotTimer);
    if (this.persistTimer) clearTimeout(this.persistTimer);
    for (const ws of this.conns.keys()) ws.close(code, reason);
    this.conns.clear();
    this.awareness.destroy();
    this.doc.destroy();
  }

  // ---- transport ----------------------------------------------------------------------------

  private sendAwarenessSnapshot(ws: WebSocket) {
    const states = this.awareness.getStates();
    if (states.size === 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(states.keys())),
    );
    this.send(ws, encoding.toUint8Array(encoder));
  }

  private broadcast(message: Uint8Array) {
    for (const ws of this.conns.keys()) this.send(ws, message);
  }

  private send(ws: WebSocket, message: Uint8Array) {
    if (ws.readyState !== ws.OPEN) return this.removeConnection(ws);
    ws.send(message, (err) => {
      if (err) this.removeConnection(ws);
    });
  }
}
