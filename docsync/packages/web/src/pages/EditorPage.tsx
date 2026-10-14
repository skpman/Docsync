import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useState } from 'react';
import { api, cache, isNetworkError, type DocumentMeta, type Session } from '../api';
import { Presence } from '../components/Presence';
import { ShareDialog } from '../components/ShareDialog';
import { Toolbar } from '../components/Toolbar';
import { VersionPanel } from '../components/VersionPanel';
import { useCollab, useOnline, usePresence, type Collab } from '../collab';

export function EditorPage({ docId, session }: { docId: string; session: Session }) {
  const [meta, setMeta] = useState<DocumentMeta | null>(() => cache.get(`doc:${docId}`));
  const [metaError, setMetaError] = useState<string | null>(null);
  const [title, setTitle] = useState(meta?.title ?? '');
  const [panel, setPanel] = useState<'share' | 'versions' | null>(null);
  const collab = useCollab(docId, session.token, session.user);
  const presence = usePresence(collab?.provider, session.user.id);
  const online = useOnline();

  useEffect(() => {
    api
      .getDocument(docId)
      .then((d) => {
        setMeta(d);
        setTitle(d.title);
        cache.set(`doc:${docId}`, d);
      })
      .catch((err) => {
        // Offline: keep using cached metadata, the content comes from IndexedDB
        if (!isNetworkError(err)) setMetaError(err.message);
      });
  }, [docId, online]);

  async function saveTitle() {
    const next = title.trim();
    if (!meta || !next || next === meta.title) return setTitle(meta?.title ?? '');
    try {
      const d = await api.renameDocument(docId, next);
      setMeta(d);
      cache.set(`doc:${docId}`, d);
    } catch (err) {
      setTitle(meta.title);
      alert(isNetworkError(err) ? 'Renaming needs a connection.' : (err as Error).message);
    }
  }

  if (metaError) {
    return (
      <div className="page">
        <main className="container">
          <p className="error">{metaError}</p>
          <a href="#/">Back to documents</a>
        </main>
      </div>
    );
  }

  const role = meta?.role ?? 'viewer';
  const canEdit = role !== 'viewer' && collab?.connection !== 'denied';

  return (
    <div className="page editor-page">
      <header className="topbar">
        <div className="row grow">
          <a href="#/" className="ghost back" title="All documents">
            ←
          </a>
          <input
            className="title-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            disabled={role === 'viewer'}
            aria-label="Document title"
          />
          {role === 'viewer' && <span className="pill">View only</span>}
        </div>
        <div className="row">
          {collab && <SyncStatus collab={collab} />}
          <Presence users={presence} />
          <button className="ghost" onClick={() => setPanel(panel === 'versions' ? null : 'versions')}>
            History
          </button>
          <button className="primary" onClick={() => setPanel('share')}>
            Share
          </button>
        </div>
      </header>

      <div className="editor-layout">
        <main className="editor-main">
          {collab && meta ? (
            <CollabEditor key={docId} collab={collab} session={session} editable={canEdit} />
          ) : (
            <p className="muted container">Opening document…</p>
          )}
        </main>
        {panel === 'versions' && <VersionPanel docId={docId} role={role} onClose={() => setPanel(null)} />}
      </div>
      {panel === 'share' && <ShareDialog docId={docId} role={role} onClose={() => setPanel(null)} />}
    </div>
  );
}

function CollabEditor({ collab, session, editable }: { collab: Collab; session: Session; editable: boolean }) {
  const { ydoc, provider } = collab;
  const editor = useEditor(
    {
      editable,
      extensions: [
        // Yjs keeps its own undo history (only your own changes), so ProseMirror's is disabled
        StarterKit.configure({ history: false }),
        Collaboration.configure({ document: ydoc }),
        CollaborationCursor.configure({
          provider,
          user: { id: session.user.id, name: session.user.name, color: session.user.color },
        }),
        Placeholder.configure({ placeholder: 'Start writing…' }),
      ],
    },
    [ydoc, provider],
  );

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  if (!collab.localReady) return <p className="muted container">Loading local copy…</p>;
  return (
    <>
      {editable && <Toolbar editor={editor} />}
      <div className="paper">
        <EditorContent editor={editor} className="prose" />
      </div>
    </>
  );
}

function SyncStatus({ collab }: { collab: Collab }) {
  const { connection, synced, deniedReason } = collab;
  let text: string;
  let tone: string;
  if (connection === 'denied') {
    text = deniedReason ?? 'No access';
    tone = 'bad';
  } else if (connection === 'online' && synced) {
    text = 'All changes synced';
    tone = 'good';
  } else if (connection === 'online' || connection === 'connecting') {
    text = 'Syncing…';
    tone = 'wait';
  } else {
    text = 'Offline · edits saved on this device';
    tone = 'warn';
  }
  return (
    <span className={`status ${tone}`} role="status">
      <span className="dot" />
      {text}
    </span>
  );
}
