import { useEffect, useState } from 'react';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { syncUrl, type User } from './api';

export type ConnectionState = 'connecting' | 'online' | 'offline' | 'denied';

export interface Collab {
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  /** Local replica has loaded from IndexedDB (editing can start even with no network). */
  localReady: boolean;
  /** Connected and fully exchanged state with the sync server. */
  synced: boolean;
  connection: ConnectionState;
  deniedReason: string | null;
}

/**
 * Sets up the local CRDT replica for a document:
 *   - y-indexeddb keeps a durable copy on this device, so edits work and survive offline
 *   - y-websocket syncs with the server and carries Awareness (cursors, presence)
 * Offline edits are plain Yjs updates; on reconnect the sync handshake exchanges whatever each
 * side is missing and the CRDT merges them without conflicts.
 */
export function useCollab(docId: string, token: string, user: User): Collab | null {
  const [collab, setCollab] = useState<Collab | null>(null);

  useEffect(() => {
    const ydoc = new Y.Doc();
    // Scope the offline store per user so a shared computer doesn't mix accounts
    const local = new IndexeddbPersistence(`docsync:${user.id}:${docId}`, ydoc);
    const provider = new WebsocketProvider(syncUrl(), docId, ydoc, {
      params: { token },
      maxBackoffTime: 5000,
    });
    provider.awareness.setLocalStateField('user', { id: user.id, name: user.name, color: user.color });

    let state: Collab = {
      ydoc,
      provider,
      localReady: false,
      synced: false,
      connection: 'connecting',
      deniedReason: null,
    };
    const update = (patch: Partial<Collab>) => {
      state = { ...state, ...patch };
      setCollab(state);
    };
    update({});

    local.whenSynced.then(() => update({ localReady: true }));

    provider.on('status', ({ status }: { status: string }) => {
      if (state.connection === 'denied') return;
      update({
        connection: status === 'connected' ? 'online' : status === 'connecting' && !state.synced ? 'connecting' : 'offline',
        synced: status === 'connected' ? state.synced : false,
      });
    });
    provider.on('sync', (isSynced: boolean) => update({ synced: isSynced }));
    provider.on('connection-close', (event: CloseEvent | null) => {
      // 44xx codes are the sync server refusing access: stop retrying and say why
      if (event && event.code >= 4400 && event.code < 4500) {
        provider.shouldConnect = false;
        update({ connection: 'denied', deniedReason: event.reason || 'Access denied', synced: false });
      }
    });

    // Follow the browser's network state: a socket can sit half-open for a while after the
    // network drops, so close it right away and keep working against the local replica.
    const goOnline = () => {
      if (state.connection !== 'denied') provider.connect();
    };
    const goOffline = () => provider.disconnect();
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      provider.destroy();
      local.destroy();
      ydoc.destroy();
      setCollab(null);
    };
  }, [docId, token, user.id, user.name, user.color]);

  return collab;
}

export interface PresenceUser {
  id: string;
  name: string;
  color: string;
  isSelf: boolean;
}

/** People currently in the document, from Awareness (deduplicated across tabs). */
export function usePresence(provider: WebsocketProvider | undefined, selfId: string): PresenceUser[] {
  const [users, setUsers] = useState<PresenceUser[]>([]);
  useEffect(() => {
    if (!provider) return;
    const awareness = provider.awareness;
    const refresh = () => {
      const seen = new Map<string, PresenceUser>();
      awareness.getStates().forEach((state) => {
        const u = state.user;
        if (u?.id && !seen.has(u.id)) seen.set(u.id, { id: u.id, name: u.name, color: u.color, isSelf: u.id === selfId });
      });
      setUsers([...seen.values()].sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || a.name.localeCompare(b.name)));
    };
    refresh();
    awareness.on('change', refresh);
    return () => awareness.off('change', refresh);
  }, [provider, selfId]);
  return users;
}

/** Tracks the browser's network state. */
export function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
