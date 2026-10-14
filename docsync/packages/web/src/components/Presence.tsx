import type { PresenceUser } from '../collab';

export function Presence({ users }: { users: PresenceUser[] }) {
  const shown = users.slice(0, 5);
  return (
    <div className="presence" aria-label={`${users.length} people here`}>
      {shown.map((u) => (
        <span key={u.id} className="avatar" style={{ background: u.color }} title={u.isSelf ? `${u.name} (you)` : u.name}>
          {u.name[0]?.toUpperCase()}
        </span>
      ))}
      {users.length > shown.length && <span className="avatar more">+{users.length - shown.length}</span>}
    </div>
  );
}
