import { useEffect, useState } from 'react';
import { navigate } from '../App';
import { api, cache, isNetworkError, saveSession, type DocumentMeta, type Session } from '../api';
import { useOnline } from '../collab';

const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function DocumentList({ session }: { session: Session }) {
  const cacheKey = `docs:${session.user.id}`;
  const [docs, setDocs] = useState<DocumentMeta[] | null>(() => cache.get(cacheKey));
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const online = useOnline();

  useEffect(() => {
    api
      .listDocuments()
      .then((list) => {
        setDocs(list);
        setStale(false);
        cache.set(cacheKey, list);
        list.forEach((d) => cache.set(`doc:${d.id}`, d));
      })
      .catch((err) => {
        if (isNetworkError(err)) setStale(true);
        else setError(err.message);
      });
  }, [cacheKey, online]);

  async function create() {
    try {
      const doc = await api.createDocument();
      cache.set(`doc:${doc.id}`, doc);
      navigate(`/d/${doc.id}`);
    } catch (err) {
      setError(isNetworkError(err) ? 'New documents need a connection. Existing ones work offline.' : (err as Error).message);
    }
  }

  async function remove(doc: DocumentMeta) {
    if (!confirm(`Delete "${doc.title}" for everyone? This can't be undone.`)) return;
    try {
      await api.deleteDocument(doc.id);
      setDocs((d) => d?.filter((x) => x.id !== doc.id) ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <img src="/icon.svg" alt="" width={28} height={28} />
          <strong>DocSync</strong>
        </div>
        <div className="row">
          <span className="avatar" style={{ background: session.user.color }} title={session.user.email}>
            {session.user.name[0]?.toUpperCase()}
          </span>
          <button className="ghost" onClick={() => saveSession(null)}>
            Sign out
          </button>
        </div>
      </header>

      <main className="container">
        <div className="row between">
          <h2>Documents</h2>
          <button className="primary" onClick={create}>
            New document
          </button>
        </div>
        {(stale || !online) && (
          <p className="banner">You're offline. Showing documents from your last visit; they open and edit offline.</p>
        )}
        {error && <p className="error">{error}</p>}
        {docs === null ? (
          <p className="muted">Loading…</p>
        ) : docs.length === 0 ? (
          <div className="empty card">
            <p>No documents yet.</p>
            <button className="primary" onClick={create}>
              Create your first document
            </button>
          </div>
        ) : (
          <ul className="doc-list">
            {docs.map((d) => (
              <li key={d.id} className="card doc-item">
                <a href={`#/d/${d.id}`}>
                  <strong>{d.title}</strong>
                  <span className="muted small">
                    {d.role === 'owner' ? 'Owned by you' : `${d.ownerName} · ${d.role}`} · edited{' '}
                    {fmt.format(new Date(d.updatedAt))}
                  </span>
                </a>
                {d.role === 'owner' && (
                  <button className="ghost danger small" onClick={() => remove(d)}>
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
