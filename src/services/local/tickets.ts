import { getDb } from './db';
import { normalizeAttention, validateAttention, type AttentionErrors } from '../../domain/validation';
import type { AttentionInput, RemoteTicket, SyncOp, Ticket } from '../../domain/types';

export class ValidationFailed extends Error {
  constructor(public errors: AttentionErrors) { super('Datos no válidos'); }
}

const uuid = () => crypto.randomUUID();

/** Campos que solo el técnico escribe; el resto viene siempre del servidor (oficina). */
export const ATTENTION_KEYS = ['service_status', 'pppoe_confirmed', 'address_confirmed', 'discrepancy_notes', 'diagnosis', 'action_taken', 'result', 'observations'] as const;

export const attentionOf = (t: Ticket): AttentionInput => ({
  status: t.service_status === 'completed' ? 'completed' : 'in_progress',
  pppoe_confirmed: t.pppoe_confirmed, address_confirmed: t.address_confirmed, discrepancy_notes: t.discrepancy_notes,
  diagnosis: t.diagnosis, action_taken: t.action_taken, result: t.result, observations: t.observations,
});

/** Copia del servidor sin cambios locales. */
export function fromRemote(r: RemoteTicket, ownerId: string): Ticket {
  return {
    ...r, ownerId, syncStatus: 'synced', syncAttempts: 0, lastSyncAttemptAt: null, lastSyncError: null,
    lastSyncErrorKind: null, localUpdatedAt: Date.now(), serverUpdatedAt: r.updated_at, localVersion: 1,
    hasLocalChanges: false, conflict: null,
  };
}

/**
 * Guarda localmente (primera operación persistente) la atención del técnico y deja UNA operación en cola.
 * Editar de nuevo un pendiente reutiliza la operación: siempre viaja la última versión.
 */
export async function saveAttentionLocal(id: string, ownerId: string, input: AttentionInput): Promise<Ticket> {
  const errors = validateAttention(input);
  if (Object.keys(errors).length) throw new ValidationFailed(errors);
  const a = normalizeAttention(input);
  const db = await getDb();
  const tx = db.transaction(['tickets', 'sync_queue'], 'readwrite');
  const quiet = () => tx.done.catch(() => {});
  const current = await tx.objectStore('tickets').get(id);
  if (!current || current.ownerId !== ownerId) { quiet(); tx.abort(); throw new Error('Ticket no encontrado'); }
  if (current.conflict) { quiet(); tx.abort(); throw new Error('Resuelve primero el conflicto de este ticket.'); }
  if (!['assigned', 'in_progress'].includes(current.service_status) && !current.hasLocalChanges) {
    quiet(); tx.abort(); throw new Error('Este ticket ya no admite cambios.');
  }
  const now = Date.now();
  const localVersion = current.localVersion + 1;
  const updated: Ticket = {
    ...current, service_status: a.status, pppoe_confirmed: a.pppoe_confirmed, address_confirmed: a.address_confirmed,
    discrepancy_notes: a.discrepancy_notes, diagnosis: a.diagnosis, action_taken: a.action_taken, result: a.result,
    observations: a.observations, localVersion, localUpdatedAt: now, hasLocalChanges: true,
    syncStatus: current.syncStatus === 'syncing' ? 'syncing' : 'pending', syncAttempts: 0,
    lastSyncError: null, lastSyncErrorKind: null,
  };
  const queue = tx.objectStore('sync_queue');
  const existing = await queue.index('ticketId').get(id);
  if (existing) {
    await queue.put({ ...existing, payloadVersion: localVersion, nextAttemptAt: 0, lastError: null,
      attempts: current.syncStatus === 'syncing' ? existing.attempts : 0 });
  } else {
    const op: SyncOp = { operationId: uuid(), ticketId: id, ownerId, createdAt: now, attempts: 0, nextAttemptAt: 0,
      lastError: null, payloadVersion: localVersion, attemptOperationId: null, attemptLocalVersion: null };
    await queue.put(op);
  }
  await Promise.all([tx.objectStore('tickets').put(updated), tx.done]);
  return updated;
}

export async function getTicket(id: string, ownerId: string): Promise<Ticket | undefined> {
  const t = await (await getDb()).get('tickets', id);
  return t && t.ownerId === ownerId ? t : undefined;
}

const ORDER: Record<string, number> = { in_progress: 0, assigned: 1, completed: 2, cancelled: 3, unassigned: 4 };
export async function listTickets(ownerId: string): Promise<Ticket[]> {
  const all = await (await getDb()).getAllFromIndex('tickets', 'ownerId', ownerId);
  return all.sort((a, b) => (ORDER[a.service_status] - ORDER[b.service_status])
    || Date.parse(b.assigned_at ?? b.created_at) - Date.parse(a.assigned_at ?? a.created_at));
}

export async function listOps(ownerId: string): Promise<SyncOp[]> {
  const all = await (await getDb()).getAllFromIndex('sync_queue', 'ownerId', ownerId);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function syncCounts(ownerId: string) {
  const tickets = await listTickets(ownerId);
  const active = tickets.filter((t) => t.service_status === 'assigned' || t.service_status === 'in_progress');
  return {
    total: tickets.length,
    toStart: active.filter((t) => t.service_status === 'assigned').length,
    inProgress: active.filter((t) => t.service_status === 'in_progress').length,
    pending: tickets.filter((t) => t.syncStatus === 'pending' || t.syncStatus === 'syncing').length,
    errors: tickets.filter((t) => t.syncStatus === 'error').length,
  };
}

/** Conflicto de versión → conservar mis notas de atención y reenviarlas sobre la versión actual (los datos de oficina vienen del servidor). */
export async function resolveKeepMine(id: string, ownerId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['tickets', 'sync_queue'], 'readwrite');
  const t = await tx.objectStore('tickets').get(id);
  const r = t?.conflict?.remote;
  if (!t || t.ownerId !== ownerId || t.conflict?.reason !== 'version' || !r) { tx.done.catch(() => {}); tx.abort(); return; }
  const op = await tx.objectStore('sync_queue').index('ticketId').get(id);
  const mine = Object.fromEntries(ATTENTION_KEYS.map((k) => [k, t[k]]));
  await Promise.all([
    tx.objectStore('tickets').put({ ...t, ...r, ...mine, conflict: null, syncStatus: 'pending', syncAttempts: 0,
      lastSyncError: null, lastSyncErrorKind: null, hasLocalChanges: true, localVersion: t.localVersion + 1 }),
    op ? tx.objectStore('sync_queue').put({ ...op, attempts: 0, nextAttemptAt: 0, lastError: null, attemptOperationId: null, attemptLocalVersion: null, payloadVersion: t.localVersion + 1 }) : Promise.resolve(),
    tx.done,
  ]);
}

/** Descartar mis cambios locales de ese ticket (acción explícita del técnico). */
export async function resolveUseServer(id: string, ownerId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['tickets', 'sync_queue'], 'readwrite');
  const t = await tx.objectStore('tickets').get(id);
  if (!t || t.ownerId !== ownerId || !t.conflict) { tx.done.catch(() => {}); tx.abort(); return; }
  const op = await tx.objectStore('sync_queue').index('ticketId').get(id);
  const r = t.conflict.remote;
  await Promise.all([
    r ? tx.objectStore('tickets').put(fromRemote(r, ownerId)) : tx.objectStore('tickets').delete(id), // reasignado y ya invisible: sale del dispositivo
    op ? tx.objectStore('sync_queue').delete(op.operationId) : Promise.resolve(),
    tx.done,
  ]);
}
