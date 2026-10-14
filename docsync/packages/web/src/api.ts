export interface User {
  id: string;
  email: string;
  name: string;
  color: string;
}

export type Role = 'owner' | 'editor' | 'viewer';

export interface DocumentMeta {
  id: string;
  title: string;
  ownerId: string;
  ownerName?: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface Permission {
  userId: string;
  email: string;
  name: string;
  color: string;
  role: Role;
}

export interface Version {
  version: number;
  label: string | null;
  reason: 'auto' | 'manual' | 'pre-restore' | 'close';
  sizeBytes: number;
  createdAt: string;
  createdByName: string | null;
}

const API = import.meta.env.VITE_API_URL ?? '/api';
const SESSION_KEY = 'docsync.session';

export interface Session {
  token: string;
  user: User;
}

// ---- session ------------------------------------------------------------------------------

export function loadSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null');
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event('docsync:session'));
}

// ---- small offline cache for metadata (document content is in IndexedDB via Yjs) -------------

export const cache = {
  get<T>(key: string): T | null {
    try {
      return JSON.parse(localStorage.getItem(`docsync.cache.${key}`) ?? 'null');
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(`docsync.cache.${key}`, JSON.stringify(value));
    } catch {
      /* storage full or blocked: cache is optional */
    }
  },
};

// ---- requests -----------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** True when a request failed because we couldn't reach the server (as opposed to an API error). */
export const isNetworkError = (err: unknown) => !(err instanceof ApiError);

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = loadSession();
  const headers = new Headers(init.headers);
  if (session) headers.set('authorization', `Bearer ${session.token}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (res.status === 401 && session) saveSession(null);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.arrayBuffer()) as Promise<T>;
}

const json = (body: unknown) => JSON.stringify(body);

export const api = {
  register: (email: string, name: string, password: string) =>
    request<Session>('/auth/register', { method: 'POST', body: json({ email, name, password }) }),
  login: (email: string, password: string) =>
    request<Session>('/auth/login', { method: 'POST', body: json({ email, password }) }),

  listDocuments: () => request<{ documents: DocumentMeta[] }>('/documents').then((r) => r.documents),
  createDocument: (title?: string) =>
    request<{ document: DocumentMeta }>('/documents', { method: 'POST', body: json({ title }) }).then(
      (r) => r.document,
    ),
  getDocument: (id: string) => request<{ document: DocumentMeta }>(`/documents/${id}`).then((r) => r.document),
  renameDocument: (id: string, title: string) =>
    request<{ document: DocumentMeta }>(`/documents/${id}`, { method: 'PATCH', body: json({ title }) }).then(
      (r) => r.document,
    ),
  deleteDocument: (id: string) => request<void>(`/documents/${id}`, { method: 'DELETE' }),

  listPermissions: (id: string) =>
    request<{ permissions: Permission[] }>(`/documents/${id}/permissions`).then((r) => r.permissions),
  share: (id: string, email: string, role: 'editor' | 'viewer') =>
    request<void>(`/documents/${id}/permissions`, { method: 'PUT', body: json({ email, role }) }),
  unshare: (id: string, userId: string) =>
    request<void>(`/documents/${id}/permissions/${userId}`, { method: 'DELETE' }),

  listVersions: (id: string) => request<{ versions: Version[] }>(`/documents/${id}/versions`).then((r) => r.versions),
  createVersion: (id: string, label?: string) =>
    request<{ version: number }>(`/documents/${id}/versions`, { method: 'POST', body: json({ label }) }),
  versionContent: (id: string, version: number) =>
    request<ArrayBuffer>(`/documents/${id}/versions/${version}/content`).then((b) => new Uint8Array(b)),
  restoreVersion: (id: string, version: number) =>
    request<{ restored: number }>(`/documents/${id}/versions/${version}/restore`, { method: 'POST' }),
};

export const syncUrl = () =>
  import.meta.env.VITE_SYNC_URL ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sync`;
