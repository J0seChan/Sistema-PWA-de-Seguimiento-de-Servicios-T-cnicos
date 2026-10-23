// Operaciones en línea de oficina/admin y consultas paginadas de historial.
// Requieren conexión: aquí no hay cola offline (decisión documentada en docs/OFFLINE_AND_CONFLICTS.md).
import { sanitizeSearch } from '../../domain/validation';
import type { Client, RemoteTicket, Technician, TicketStatus, UserRow } from '../../domain/types';
import { supabase } from './client';
import { classifyError } from '../sync/errors';
import { one } from './repository';

const db = () => { if (!supabase) throw new Error('Supabase no está configurado.'); return supabase; };
export const PAGE_SIZE = 20;

/** Mensajes en español para los errores que lanzan las funciones del servidor. */
export function friendlyError(err: unknown): string {
  const e = err as { message?: string; code?: string };
  const m = e?.message ?? '';
  const map: [string, string][] = [
    ['version_conflict', 'Otra persona modificó este ticket. Recarga para ver los cambios y vuelve a intentar.'],
    ['ticket_closed', 'El ticket ya está cerrado o cancelado.'],
    ['ticket_not_closed', 'Solo se pueden reabrir tickets completados o cancelados.'],
    ['technician_invalid', 'El técnico seleccionado no existe o no está activo.'],
    ['reason_required', 'Escribe el motivo para continuar.'],
    ['client_not_found', 'El cliente ya no existe.'],
    ['clients_pppoe_key_uidx', 'Ya existe un cliente con ese usuario PPPoE.'],
    ['forbidden', 'No tienes permiso para esta acción.'],
  ];
  for (const [k, v] of map) if (m.includes(k)) return v;
  const kind = classifyError(err);
  if (kind === 'offline') return 'Sin conexión. Esta función necesita Internet.';
  if (kind === 'session') return 'Tu sesión expiró. Inicia sesión de nuevo.';
  if (kind === 'permission') return 'No tienes permiso para esta acción.';
  if (e?.code === '23505') return 'Ya existe un registro con esos datos.';
  return m || 'Ocurrió un error inesperado.';
}
const check = <T>(r: { data: T; error: unknown }): T => { if (r.error) throw new Error(friendlyError(r.error)); return r.data; };

/* ---- Clientes ---- */
export async function searchClients(q: string): Promise<Client[]> {
  const s = sanitizeSearch(q);
  if (!s) return [];
  return check(await db().from('clients').select('*').or(`pppoe_key.ilike.%${s.toLowerCase()}%,full_name.ilike.%${s}%`).order('pppoe_key').limit(15)) as Client[];
}
export async function getClient(id: string): Promise<Client | null> {
  return check(await db().from('clients').select('*').eq('id', id).maybeSingle()) as Client | null;
}
export interface ClientFields { pppoe_username: string; full_name: string; address: string; address_reference: string; contact_phone: string }
const clean = (f: ClientFields) => ({ pppoe_username: f.pppoe_username.trim(), full_name: f.full_name.trim() || null, address: f.address.trim(),
  address_reference: f.address_reference.trim() || null, contact_phone: f.contact_phone.trim() || null });
export async function createClientRow(f: ClientFields): Promise<Client> {
  return check(await db().from('clients').insert(clean(f)).select().single()) as Client;
}
export async function updateClientRow(id: string, version: number, f: ClientFields): Promise<Client> {
  const rows = check(await db().from('clients').update(clean(f)).eq('id', id).eq('version', version).select()) as Client[];
  if (rows.length !== 1) throw new Error(friendlyError({ message: 'version_conflict' }));
  return rows[0];
}

/* ---- Tickets (escritura mediante funciones del servidor) ---- */
export interface NewTicketArgs { id: string; client_id: string; service_type: string; reported_problem: string; technician_id: string | null; external_ticket_ref: string | null }
export async function createTicketRemote(a: NewTicketArgs): Promise<RemoteTicket> {
  return one<RemoteTicket>(check(await db().rpc('create_ticket', { p_id: a.id, p_client_id: a.client_id, p_service_type: a.service_type,
    p_reported_problem: a.reported_problem, p_technician_id: a.technician_id, p_external_ticket_ref: a.external_ticket_ref })));
}
export async function assignTicket(id: string, technicianId: string, version: number, reason: string | null): Promise<RemoteTicket> {
  return one(check(await db().rpc('assign_ticket', { p_ticket_id: id, p_technician_id: technicianId, p_expected_version: version, p_reason: reason })));
}
export async function cancelTicket(id: string, version: number, reason: string): Promise<RemoteTicket> {
  return one(check(await db().rpc('cancel_ticket', { p_ticket_id: id, p_expected_version: version, p_reason: reason })));
}
export async function reopenTicket(id: string, version: number, reason: string): Promise<RemoteTicket> {
  return one(check(await db().rpc('reopen_ticket', { p_ticket_id: id, p_expected_version: version, p_reason: reason })));
}
export async function updateTicketOffice(id: string, version: number, serviceType: string, problem: string, ref: string | null): Promise<RemoteTicket> {
  return one(check(await db().rpc('update_ticket_office', { p_ticket_id: id, p_expected_version: version, p_service_type: serviceType,
    p_reported_problem: problem, p_external_ticket_ref: ref })));
}

/* ---- Consultas ---- */
export interface TicketFilters { q?: string; status?: string; technician_id?: string; from?: string; to?: string; client_id?: string }
export interface Page<T> { rows: T[]; hasMore: boolean }

/** Paginación real con range(); se pide una fila de más para saber si hay otra página. */
export async function listTicketsPage(f: TicketFilters, page: number): Promise<Page<RemoteTicket>> {
  let q = db().from('service_tickets').select('*');
  const s = sanitizeSearch(f.q ?? '');
  if (s) q = q.or(`folio.ilike.%${s}%,client_pppoe_snapshot.ilike.%${s}%,client_name_snapshot.ilike.%${s}%`);
  if (f.status) q = q.eq('service_status', f.status);
  if (f.technician_id) q = q.eq('technician_id', f.technician_id);
  if (f.client_id) q = q.eq('client_id', f.client_id);
  if (f.from) q = q.gte('created_at', new Date(`${f.from}T00:00:00`).toISOString());
  if (f.to) q = q.lte('created_at', new Date(`${f.to}T23:59:59.999`).toISOString());
  const from = page * PAGE_SIZE;
  const rows = check(await q.order('created_at', { ascending: false }).order('id').range(from, from + PAGE_SIZE)) as RemoteTicket[];
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

export async function countByStatus(): Promise<Record<TicketStatus, number>> {
  const statuses: TicketStatus[] = ['unassigned', 'assigned', 'in_progress', 'completed', 'cancelled'];
  const out = {} as Record<TicketStatus, number>;
  await Promise.all(statuses.map(async (s) => {
    const r = await db().from('service_tickets').select('id', { count: 'exact', head: true }).eq('service_status', s);
    if (r.error) throw new Error(friendlyError(r.error));
    out[s] = r.count ?? 0;
  }));
  return out;
}

export async function getTicketRemote(id: string): Promise<RemoteTicket | null> {
  return check(await db().from('service_tickets').select('*').eq('id', id).maybeSingle()) as RemoteTicket | null;
}

export async function listTechnicians(): Promise<Technician[]> {
  return check(await db().from('profiles').select('id, full_name').eq('role', 'technician').eq('active', true).order('full_name')) as Technician[];
}

export interface TicketEvent { id: number; event_type: string; actor_id: string | null; created_at: string; details: Record<string, unknown> }
export async function listEvents(ticketId: string): Promise<TicketEvent[]> {
  return check(await db().from('ticket_events').select('*').eq('ticket_id', ticketId).order('created_at').order('id')) as TicketEvent[];
}

/** Historial global: busca clientes (PPPoE/nombre) y tickets por folio. Requiere conexión. */
export async function searchHistory(q: string): Promise<{ clients: Client[]; tickets: RemoteTicket[] }> {
  const s = sanitizeSearch(q);
  if (!s) return { clients: [], tickets: [] };
  const [clients, tickets] = await Promise.all([
    searchClients(s),
    db().from('service_tickets').select('*').ilike('folio', `%${s}%`).order('created_at', { ascending: false }).limit(10).then((r) => check(r) as RemoteTicket[]),
  ]);
  return { clients, tickets };
}

/* ---- Administración (usuarios y roles) ---- */
export async function listUsers(): Promise<UserRow[]> {
  return check(await db().from('profiles').select('id, full_name, role, active').order('full_name')) as UserRow[];
}
export async function adminAction(body: Record<string, unknown>): Promise<void> {
  const { data, error } = await db().functions.invoke('admin-users', { body });
  if (error) {
    let msg = error.message;
    try { const j = await (error as unknown as { context: Response }).context.json(); if (j?.error) msg = j.error; } catch { /* sin cuerpo JSON */ }
    throw new Error(msg || 'No se pudo completar la acción.');
  }
  if (data?.error) throw new Error(data.error);
}
