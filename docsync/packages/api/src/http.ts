import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { getRole, roleAtLeast, UUID_RE, verifyToken, type Role, type TokenPayload } from '@docsync/common';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
      role?: Role;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = verifyToken(token);
  if (!user) throw new HttpError(401, 'Not signed in');
  req.user = user;
  next();
}

/** Loads the caller's role on :id and rejects if it's below `min`. Non-members get 404, not 403. */
export function requireRole(min: Role) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const id = req.params.id as string;
    if (!UUID_RE.test(id)) throw new HttpError(404, 'Document not found');
    const role = await getRole(id, req.user!.sub);
    if (!role) throw new HttpError(404, 'Document not found');
    if (!roleAtLeast(role, min)) throw new HttpError(403, `Requires ${min} access`);
    req.role = role;
    next();
  };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Invalid request', details: err.flatten().fieldErrors });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal error' });
}
