import { supabase } from '../remote/client';
import { createSupabaseRepo } from '../remote/repository';
import { getSessionUserId } from '../auth/auth';
import { SyncEngine, type RunResult } from './engine';
import { pullRemote } from './pull';

export const repo = supabase ? createSupabaseRepo(supabase) : null;
export const engine = repo ? new SyncEngine(repo, getSessionUserId) : null;

/** Envía lo pendiente y, si todo salió bien, trae los cambios del servidor. */
export async function syncAll(owner: { id: string; name: string }, force = false): Promise<RunResult | null> {
  if (!engine || !repo) return null;
  const res = await engine.run(owner.id, { force });
  if (res.status === 'done') {
    try { await pullRemote(repo, owner); } catch { /* la descarga falla en silencio: no afecta a lo ya enviado */ }
  }
  return res;
}
