import Collaboration from '@tiptap/extension-collaboration';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { api, type Role, type Version } from '../api';

const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const reasonText: Record<Version['reason'], string> = {
  auto: 'Autosave',
  manual: 'Saved version',
  'pre-restore': 'Before restore',
  close: 'Session ended',
};

export function VersionPanel({ docId, role, onClose }: { docId: string; role: Role; onClose: () => void }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [content, setContent] = useState<Uint8Array | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = role !== 'viewer';

  const refresh = () =>
    api
      .listVersions(docId)
      .then(setVersions)
      .catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, [docId]);

  useEffect(() => {
    setContent(null);
    if (selected === null) return;
    api
      .versionContent(docId, selected)
      .then(setContent)
      .catch((e) => setError(e.message));
  }, [docId, selected]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.createVersion(docId, label || undefined);
      setLabel('');
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function restore(version: number) {
    if (!confirm(`Restore version ${version}? Everyone will see the document change. The current state is saved first.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.restoreVersion(docId, version);
      setSelected(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="side-panel">
      <div className="row between">
        <h3>Version history</h3>
        <button className="ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {canEdit && (
        <div className="row">
          <input placeholder="Name this version (optional)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: 1 }} />
          <button className="primary" onClick={save} disabled={busy}>
            Save
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {versions === null ? (
        <p className="muted">Loading…</p>
      ) : versions.length === 0 ? (
        <p className="muted small">No versions yet. Snapshots are taken automatically while people edit.</p>
      ) : (
        <ul className="versions">
          {versions.map((v) => (
            <li key={v.version}>
              <button className={`version ${selected === v.version ? 'active' : ''}`} onClick={() => setSelected(v.version)}>
                <strong>{v.label ?? `Version ${v.version}`}</strong>
                <span className="muted small">
                  {fmt.format(new Date(v.createdAt))} · {reasonText[v.reason]}
                  {v.createdByName ? ` · ${v.createdByName}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected !== null && (
        <div className="preview">
          <div className="row between">
            <strong>Preview of v{selected}</strong>
            {canEdit && (
              <button className="primary small" onClick={() => restore(selected)} disabled={busy || !content}>
                Restore
              </button>
            )}
          </div>
          {content ? <SnapshotView state={content} /> : <p className="muted">Loading…</p>}
        </div>
      )}
    </aside>
  );
}

function SnapshotView({ state }: { state: Uint8Array }) {
  const ydoc = useMemo(() => {
    const d = new Y.Doc();
    Y.applyUpdate(d, state);
    return d;
  }, [state]);
  useEffect(() => () => ydoc.destroy(), [ydoc]);

  const editor = useEditor(
    {
      editable: false,
      extensions: [StarterKit.configure({ history: false }), Collaboration.configure({ document: ydoc })],
    },
    [ydoc],
  );
  return <EditorContent editor={editor} className="prose preview-body" />;
}
