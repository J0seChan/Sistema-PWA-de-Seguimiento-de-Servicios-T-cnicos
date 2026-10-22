import type { SupabaseClient } from '@supabase/supabase-js';
import type { RemoteTicket, TicketInput } from '../../domain/types';
import type { RemoteRepo } from '../sync/engine';
import { classifyError, SyncError } from '../sync/errors';

const raise = (error: unknown): never => {
  throw new SyncError(classifyError(error), (error as { message?: string })?.message ?? 'Error remoto');
};

export function createSupabaseRepo(db: SupabaseClient): RemoteRepo {
  const getTicket = async (id: string): Promise<RemoteTicket | null> => {
    const { data, error } = await db.from('service_tickets').select('*').eq('id', id).maybeSingle();
    if (error) raise(error);
    return (data as RemoteTicket | null) ?? null;
  };

  return {
    getTicket,

    async createTicket(t) {
      // folio, version y fechas los asigna el servidor (trigger); el cliente no puede elegirlos.
      const { data, error } = await db.from('service_tickets').insert(t).select().single();
      if (error) {
        // 23505 = el UUID ya existe: la creación anterior sí llegó, se reconoce en vez de duplicar.
        if (error.code === '23505') {
          const existing = await getTicket(t.id);
          if (existing) return existing;
        }
        raise(error);
      }
      return data as RemoteTicket;
    },

    async updateTicket(id: string, patch: TicketInput, expectedVersion: number) {
      const { data, error } = await db.from('service_tickets').update(patch).eq('id', id).eq('version', expectedVersion).select();
      if (error) raise(error);
      if (data && data.length === 1) return data[0] as RemoteTicket;
      // 0 filas: o cambió la versión (conflicto) o RLS no permite la actualización.
      const remote = await getTicket(id);
      if (remote && remote.version !== expectedVersion) throw new SyncError('conflict', 'version_conflict', remote);
      throw new SyncError('permission', 'No se pudo actualizar el servicio');
    },

    async listTickets() {
      const { data, error } = await db.from('service_tickets').select('*').order('service_date', { ascending: false }).limit(300);
      if (error) raise(error);
      return (data ?? []) as RemoteTicket[];
    },
  };
}
