import { useEffect, useState, type FormEvent } from 'react';
import { api, type Permission, type Role } from '../api';

export function ShareDialog({ docId, role, onClose }: { docId: string; role: Role; onClose: () => void }) {
  const [people, setPeople] = useState<Permission[]>([]);
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<'editor' | 'viewer'>('editor');
  const [error, setError] = useState<string | null>(null);
  const isOwner = role === 'owner';

  const refresh = () =>
    api
      .listPermissions(docId)
      .then(setPeople)
      .catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, [docId]);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.share(docId, email, newRole);
      setEmail('');
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function change(p: Permission, value: string) {
    setError(null);
    try {
      if (value === 'remove') await api.unshare(docId, p.userId);
      else await api.share(docId, p.email, value as 'editor' | 'viewer');
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Share">
        <div className="row between">
          <h3>Share</h3>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {isOwner && (
          <form className="row" onSubmit={invite}>
            <input
              type="email"
              placeholder="Email of a DocSync user"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ flex: 1 }}
            />
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as 'editor' | 'viewer')}>
              <option value="editor">Can edit</option>
              <option value="viewer">Can view</option>
            </select>
            <button className="primary">Invite</button>
          </form>
        )}
        {error && <p className="error">{error}</p>}
        <ul className="people">
          {people.map((p) => (
            <li key={p.userId} className="row between">
              <span className="row">
                <span className="avatar small" style={{ background: p.color }}>
                  {p.name[0]?.toUpperCase()}
                </span>
                <span>
                  {p.name}
                  <br />
                  <span className="muted small">{p.email}</span>
                </span>
              </span>
              {isOwner && p.role !== 'owner' ? (
                <select value={p.role} onChange={(e) => change(p, e.target.value)}>
                  <option value="editor">Can edit</option>
                  <option value="viewer">Can view</option>
                  <option value="remove">Remove</option>
                </select>
              ) : (
                <span className="muted small">{p.role}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
