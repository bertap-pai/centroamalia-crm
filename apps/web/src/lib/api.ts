import { BASE_PATH } from './base-path.js';

async function apiFetch(path: string, opts?: RequestInit): Promise<any> {
  const res = await fetch(BASE_PATH + path, { credentials: 'include', ...opts });
  if (res.status === 401) {
    window.location.href = `${BASE_PATH}/login`;
    throw new Error('Unauthorized');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.message ?? res.statusText) as any;
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function jsonOpts(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
}

export const api = {
  get: (path: string) => apiFetch(path),
  post: (path: string, body?: unknown) => apiFetch(path, jsonOpts('POST', body)),
  patch: (path: string, body?: unknown) => apiFetch(path, jsonOpts('PATCH', body)),
  delete: (path: string) => apiFetch(path, { method: 'DELETE' }),
};

export type ApiError = Error & { status: number; data?: any };
