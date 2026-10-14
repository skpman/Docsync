import * as Y from 'yjs';
import { query, snapshotKey, snapshotStore, withTransaction } from '@docsync/common';

export type SnapshotReason = 'auto' | 'manual' | 'pre-restore' | 'close';

export async function documentExists(documentId: string): Promise<boolean> {
  const { rowCount } = await query('SELECT 1 FROM documents WHERE id = $1', [documentId]);
  return (rowCount ?? 0) > 0;
}

/** Loads the last persisted Yjs state into `doc`. */
export async function loadState(documentId: string, doc: Y.Doc): Promise<void> {
  const { rows } = await query<{ ydoc_state: Buffer | null }>('SELECT ydoc_state FROM documents WHERE id = $1', [
    documentId,
  ]);
  const state = rows[0]?.ydoc_state;
  if (state && state.length) Y.applyUpdate(doc, new Uint8Array(state), 'persistence');
}

export async function saveState(documentId: string, doc: Y.Doc): Promise<void> {
  const state = Y.encodeStateAsUpdate(doc);
  await query(
    'UPDATE documents SET ydoc_state = $2, state_updated_at = now(), updated_at = now() WHERE id = $1',
    [documentId, Buffer.from(state)],
  );
}

/**
 * Writes the full document state to the object store and records a new version row.
 * The row lock on the document serializes concurrent snapshots so versions stay gapless.
 */
export async function writeSnapshot(
  documentId: string,
  doc: Y.Doc,
  reason: SnapshotReason,
  userId: string | null = null,
  label: string | null = null,
): Promise<number> {
  const state = Y.encodeStateAsUpdate(doc);
  return withTransaction(async (client) => {
    const locked = await client.query('SELECT id FROM documents WHERE id = $1 FOR UPDATE', [documentId]);
    if (!locked.rowCount) throw new Error('Document not found');
    const { rows } = await client.query<{ next: number }>(
      'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM document_snapshots WHERE document_id = $1',
      [documentId],
    );
    const version = rows[0].next;
    const key = snapshotKey(documentId, version);
    await snapshotStore.put(key, state);
    await client.query(
      `INSERT INTO document_snapshots (document_id, version, object_key, size_bytes, label, reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [documentId, version, key, state.byteLength, label, reason, userId],
    );
    return version;
  });
}

export async function readSnapshot(documentId: string, version: number): Promise<Uint8Array | null> {
  const { rows } = await query<{ object_key: string }>(
    'SELECT object_key FROM document_snapshots WHERE document_id = $1 AND version = $2',
    [documentId, version],
  );
  if (!rows[0]) return null;
  return snapshotStore.get(rows[0].object_key);
}
