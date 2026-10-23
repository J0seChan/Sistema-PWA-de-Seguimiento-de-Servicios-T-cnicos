import type { SupabaseClient } from '@supabase/supabase-js';
import type { AttentionInput, RemoteTicket } from '../../domain/types';
import type { RemoteRepo } from '../sync/engine';
import { classifyError, SyncError } from '../sync/errors';

const raise = (error: unknown): never => {
  throw new SyncError(classifyError(error), (error as { message?: string })?.message ?? 'Error remoto');
};
export const one = <T>(data: unknown): T => (Array.isArray(data) ? data[0] : data) as T;
const PAGE = 200;

export function createSupabaseRepo(db: SupabaseClient): RemoteRepo {
  const getTicket = async (id: string): Promise<RemoteTicket | null> => {
    const { data, error } = await db.from('service_tickets').select('*').eq('id', id).maybeSingle();
    if (error) raise(error);
    return (data as RemoteTicket | null) ?? null;
  };
  const safeGet = (id: string) => getTicket(id).catch(() => null);

  /** Recorre TODAS las páginas (sin tope silencioso). */
  async function all(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<RemoteTicket[]> {
    const rows: RemoteTicket[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build(from, from + PAGE - 1);
      if (error) raise(error);
      const page = (data ?? []) as RemoteTicket[];
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  }

  return {
    getTicket,

    async saveAttention(ticketId: string, expectedVersion: number, operationId: string, i: AttentionInput) {
      const { data, error } = await db.rpc('save_ticket_attention', {
        p_ticket_id: ticketId, p_expected_version: expectedVersion, p_operation_id: operationId, p_status: i.status,
        p_pppoe_confirmed: i.pppoe_confirmed, p_address_confirmed: i.address_confirmed, p_discrepancy_notes: i.discrepancy_notes,
        p_diagnosis: i.diagnosis, p_action_taken: i.action_taken, p_result: i.result, p_observations: i.observations,
      });
      if (!error) return one<RemoteTicket>(data);
      const msg = error.message ?? '';
      if (msg.includes('version_conflict')) throw new SyncError('conflict', msg, await safeGet(ticketId), 'version');
      if (msg.includes('not_assigned')) throw new SyncError('conflict', msg, await safeGet(ticketId), 'reassigned');
      if (msg.includes('ticket_closed')) throw new SyncError('conflict', msg, await safeGet(ticketId), 'closed');
      if (msg.includes('completion_requirements') || msg.includes('invalid_status')) throw new SyncError('validation', msg);
      return raise(error);
    },

    async listMyTickets(userId: string) {
      const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
      const active = await all((from, to) => db.from('service_tickets').select('*').eq('technician_id', userId)
        .in('service_status', ['assigned', 'in_progress']).order('created_at').order('id').range(from, to));
      const recent = await all((from, to) => db.from('service_tickets').select('*').eq('technician_id', userId)
        .eq('service_status', 'completed').gte('completed_at', since).order('completed_at', { ascending: false }).order('id').range(from, to));
      return [...active, ...recent];
    },
  };
}
