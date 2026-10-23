import { supabase } from '../remote/client';
import { createSupabaseRepo } from '../remote/repository';
import { getSessionUserId } from '../auth/auth';
import { SyncEngine, type RunResult } from './engine';
import { pullMyTickets } from './pull';

export const repo = supabase ? createSupabaseRepo(supabase) : null;
export const engine = repo ? new SyncEngine(repo, getSessionUserId) : null;

/** Envía lo pendiente y, si todo salió bien, descarga los tickets del técnico. */
export async function syncAll(ownerId: string, force = false): Promise<RunResult | null> {
  if (!engine || !repo) return null;
  const res = await engine.run(ownerId, { force });
  if (res.status === 'done') {
    try { await pullMyTickets(repo, ownerId); } catch { /* la descarga falla en silencio: no afecta a lo ya enviado */ }
  }
  return res;
}
