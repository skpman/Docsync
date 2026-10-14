import { Router } from 'express';
import { z } from 'zod';
import { query, snapshotStore, withTransaction } from '@docsync/common';
import { HttpError, requireAuth, requireRole } from '../http.js';
import { callSync, notifySync } from '../syncClient.js';

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

const DOC_COLUMNS = `d.id, d.title, d.owner_id AS "ownerId", d.created_at AS "createdAt", d.updated_at AS "updatedAt"`;

// ---- documents ------------------------------------------------------------------------------

documentsRouter.get('/', async (req, res) => {
  const { rows } = await query(
    `SELECT ${DOC_COLUMNS}, p.role, u.name AS "ownerName"
       FROM documents d
       JOIN document_permissions p ON p.document_id = d.id AND p.user_id = $1
       JOIN users u ON u.id = d.owner_id
      ORDER BY d.updated_at DESC`,
    [req.user!.sub],
  );
  res.json({ documents: rows });
});

const titleBody = z.object({ title: z.string().trim().min(1).max(200) });

documentsRouter.post('/', async (req, res) => {
  const { title } = z.object({ title: titleBody.shape.title.default('Untitled document') }).parse(req.body ?? {});
  const doc = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO documents (title, owner_id) VALUES ($1, $2)
       RETURNING id, title, owner_id AS "ownerId", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [title, req.user!.sub],
    );
    await client.query(`INSERT INTO document_permissions (document_id, user_id, role) VALUES ($1, $2, 'owner')`, [
      rows[0].id,
      req.user!.sub,
    ]);
    return rows[0];
  });
  res.status(201).json({ document: { ...doc, role: 'owner' } });
});

documentsRouter.get('/:id', requireRole('viewer'), async (req, res) => {
  const { rows } = await query(
    `SELECT ${DOC_COLUMNS}, u.name AS "ownerName" FROM documents d JOIN users u ON u.id = d.owner_id WHERE d.id = $1`,
    [req.params.id],
  );
  res.json({ document: { ...rows[0], role: req.role } });
});

documentsRouter.patch('/:id', requireRole('editor'), async (req, res) => {
  const { title } = titleBody.parse(req.body);
  const { rows } = await query(
    `UPDATE documents d SET title = $2, updated_at = now() WHERE id = $1 RETURNING ${DOC_COLUMNS}`,
    [req.params.id, title],
  );
  res.json({ document: { ...rows[0], role: req.role } });
});

documentsRouter.delete('/:id', requireRole('owner'), async (req, res) => {
  const id = req.params.id as string;
  await query('DELETE FROM documents WHERE id = $1', [id]);
  notifySync(id, 'close');
  await snapshotStore.deletePrefix(`docs/${id}/`).catch((err) => console.warn('snapshot cleanup failed', err));
  res.status(204).end();
});

// ---- sharing / permissions ------------------------------------------------------------------

documentsRouter.get('/:id/permissions', requireRole('viewer'), async (req, res) => {
  const { rows } = await query(
    `SELECT u.id AS "userId", u.email, u.name, u.color, p.role
       FROM document_permissions p JOIN users u ON u.id = p.user_id
      WHERE p.document_id = $1
      ORDER BY CASE p.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.name`,
    [req.params.id],
  );
  res.json({ permissions: rows });
});

const shareBody = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  role: z.enum(['editor', 'viewer']),
});

documentsRouter.put('/:id/permissions', requireRole('owner'), async (req, res) => {
  const { email, role } = shareBody.parse(req.body);
  const { rows: users } = await query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
  if (!users[0]) throw new HttpError(404, 'No DocSync account uses that email');
  if (users[0].id === req.user!.sub) throw new HttpError(400, "You can't change your own access");
  await query(
    `INSERT INTO document_permissions (document_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (document_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [req.params.id, users[0].id, role],
  );
  notifySync(req.params.id as string, 'revalidate');
  res.status(204).end();
});

documentsRouter.delete('/:id/permissions/:userId', requireRole('owner'), async (req, res) => {
  if (req.params.userId === req.user!.sub) throw new HttpError(400, "The owner can't be removed");
  await query('DELETE FROM document_permissions WHERE document_id = $1 AND user_id = $2', [
    req.params.id,
    req.params.userId,
  ]);
  notifySync(req.params.id as string, 'revalidate');
  res.status(204).end();
});

// ---- version history ------------------------------------------------------------------------

documentsRouter.get('/:id/versions', requireRole('viewer'), async (req, res) => {
  const { rows } = await query(
    `SELECT s.version, s.label, s.reason, s.size_bytes AS "sizeBytes", s.created_at AS "createdAt",
            u.name AS "createdByName"
       FROM document_snapshots s LEFT JOIN users u ON u.id = s.created_by
      WHERE s.document_id = $1
      ORDER BY s.version DESC
      LIMIT 200`,
    [req.params.id],
  );
  res.json({ versions: rows });
});

documentsRouter.post('/:id/versions', requireRole('editor'), async (req, res) => {
  const { label } = z.object({ label: z.string().trim().max(120).optional() }).parse(req.body ?? {});
  const result = await callSync<{ version: number }>(req.params.id as string, 'snapshot', {
    userId: req.user!.sub,
    label: label || null,
  });
  res.status(201).json(result);
});

const versionParam = z.coerce.number().int().positive();

/** Raw Yjs state of a version; the client renders it read-only for preview. */
documentsRouter.get('/:id/versions/:version/content', requireRole('viewer'), async (req, res) => {
  const version = versionParam.parse(req.params.version);
  const { rows } = await query<{ object_key: string }>(
    'SELECT object_key FROM document_snapshots WHERE document_id = $1 AND version = $2',
    [req.params.id, version],
  );
  if (!rows[0]) throw new HttpError(404, 'Version not found');
  const bytes = await snapshotStore.get(rows[0].object_key);
  res.type('application/octet-stream').send(Buffer.from(bytes));
});

documentsRouter.post('/:id/versions/:version/restore', requireRole('editor'), async (req, res) => {
  const version = versionParam.parse(req.params.version);
  const result = await callSync(req.params.id as string, 'restore', { userId: req.user!.sub, version });
  res.json(result);
});
