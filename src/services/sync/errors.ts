import type { ErrorKind, RemoteTicket } from '../../domain/types';

export class SyncError extends Error {
  constructor(public kind: ErrorKind, message: string, public remote: RemoteTicket | null = null) {
    super(message);
    this.name = 'SyncError';
  }
}

interface ErrLike { message?: string; code?: string; status?: number; name?: string }

/** Convierte errores de red / Supabase / PostgREST en una categoría. */
export function classifyError(err: unknown, online = typeof navigator === 'undefined' || navigator.onLine !== false): ErrorKind {
  if (err instanceof SyncError) return err.kind;
  const e = (err ?? {}) as ErrLike;
  const msg = (e.message ?? '').toLowerCase();
  if (!online || e.name === 'TypeError' || msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed') || msg.includes('network request failed')) return 'offline';
  if (e.status === 401 || e.code === 'PGRST301' || e.code === 'PGRST303' || msg.includes('jwt') || msg.includes('not authenticated')) return 'session';
  if (e.code === '42501' || e.status === 403 || msg.includes('row-level security') || msg.includes('permission denied')) return 'permission';
  if (msg.includes('version_conflict')) return 'conflict';
  if (['23502', '23514', '22P02', '22007', '22001', '23503', 'P0001'].includes(e.code ?? '') || e.status === 400 || e.status === 422) return 'validation';
  if ((e.status ?? 0) >= 500 || e.status === 429 || e.status === 408) return 'temporary';
  return 'unknown';
}
