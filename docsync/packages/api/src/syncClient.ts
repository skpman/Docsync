import { config } from '@docsync/common';
import { HttpError } from './http.js';

/** Calls the sync server's internal endpoints, which operate on the live in-memory document. */
export async function callSync<T = unknown>(documentId: string, action: string, body: object = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.syncInternalUrl}/internal/docs/${documentId}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': config.internalSecret },
      body: JSON.stringify(body),
    });
  } catch {
    throw new HttpError(503, 'Sync server unavailable');
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 404 ? 404 : 502, data.error ?? 'Sync server error');
  return data as T;
}

/** Best-effort notification; the operation already succeeded in Postgres. */
export function notifySync(documentId: string, action: string) {
  callSync(documentId, action).catch((err) => console.warn(`sync ${action} notify failed:`, err.message));
}
