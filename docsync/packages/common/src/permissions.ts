import { query } from './db.js';

export type Role = 'owner' | 'editor' | 'viewer';

const rank: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

export function roleAtLeast(role: Role | null, min: Role): boolean {
  return role !== null && rank[role] >= rank[min];
}

export async function getRole(documentId: string, userId: string): Promise<Role | null> {
  const { rows } = await query<{ role: Role }>(
    'SELECT role FROM document_permissions WHERE document_id = $1 AND user_id = $2',
    [documentId, userId],
  );
  return rows[0]?.role ?? null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
