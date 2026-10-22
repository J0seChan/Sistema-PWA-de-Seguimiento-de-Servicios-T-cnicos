import { getDb } from './db';
import { normalizeInput, validateTicketInput, type FieldErrors } from '../../domain/validation';
import type { SyncOp, Ticket, TicketInput } from '../../domain/types';

export class ValidationFailed extends Error {
  constructor(public errors: FieldErrors) { super('Datos no válidos'); }
}

const uuid = () => crypto.randomUUID();
export interface Owner { id: string; name: string }

export async function createLocalTicket(owner: Owner, input: TicketInput): Promise<Ticket> {
  const errors = validateTicketInput(input);
  if (Object.keys(errors).length) throw new ValidationFailed(errors);
  const now = Date.now();
  const ticket: Ticket = {
    ...normalizeInput(input),
    id: uuid(), // el UUID nunca cambia durante la vida del registro
    folio: null, // lo asigna el servidor
    created_by: owner.id,
    technician_id: owner.id,
    created_at: null,
    updated_at: null,
    version: 0,
    ownerId: owner.id,
    technicianName: owner.name,
    syncStatus: 'pending',
    syncAttempts: 0,
    lastSyncAttemptAt: null,
    lastSyncError: null,
    lastSyncErrorKind: null,
    localUpdatedAt: now,
    serverUpdatedAt: null,
    localVersion: 1,
    conflictRemote: null,
  };
  const op: SyncOp = {
    operationId: uuid(), ticketId: ticket.id, ownerId: owner.id, operationType: 'create',
    createdAt: now, attempts: 0, nextAttemptAt: 0, lastError: null, payloadVersion: 1,
  };
  const db = await getDb();
  const tx = db.transaction(['tickets', 'sync_queue'], 'readwrite');
  await Promise.all([tx.objectStore('tickets').put(ticket), tx.objectStore('sync_queue').put(op), tx.done]);
  return ticket;
}

/**
 * Edita un registro. Si ya había una operación pendiente se reutiliza (el payload se
 * lee del registro al enviar, así que siempre viaja la última versión: no hay duplicados).
 */
export async function updateLocalTicket(id: string, ownerId: string, input: TicketInput): Promise<Ticket> {
  const errors = validateTicketInput(input);
  if (Object.keys(errors).length) throw new ValidationFailed(errors);
  const db = await getDb();
  const tx = db.transaction(['tickets', 'sync_queue'], 'readwrite');
  const tickets = tx.objectStore('tickets');
  const queue = tx.objectStore('sync_queue');
  const current = await tickets.get(id);
  if (!current || current.ownerId !== ownerId) { tx.done.catch(() => {}); tx.abort(); throw new Error('Servicio no encontrado'); }
  if (current.conflictRemote) { tx.done.catch(() => {}); tx.abort(); throw new Error('Resuelve primero el conflicto de este servicio.'); }
  const now = Date.now();
  const localVersion = current.localVersion + 1;
  const updated: Ticket = {
    ...current,
    ...normalizeInput(input),
    localVersion,
    localUpdatedAt: now,
    syncStatus: current.syncStatus === 'syncing' ? 'syncing' : 'pending',
    syncAttempts: 0,
    lastSyncError: null,
    lastSyncErrorKind: null,
  };
  const existing = await queue.index('ticketId').get(id);
  if (existing) {
    await queue.put({ ...existing, payloadVersion: localVersion, nextAttemptAt: 0, attempts: current.syncStatus === 'syncing' ? existing.attempts : 0, lastError: null });
  } else {
    await queue.put({
      operationId: uuid(), ticketId: id, ownerId, operationType: 'update',
      createdAt: now, attempts: 0, nextAttemptAt: 0, lastError: null, payloadVersion: localVersion,
    });
  }
  await Promise.all([tickets.put(updated), tx.done]);
  return updated;
}

export async function getTicket(id: string, ownerId: string): Promise<Ticket | undefined> {
  const t = await (await getDb()).get('tickets', id);
  return t && t.ownerId === ownerId ? t : undefined;
}

export async function listTickets(ownerId: string): Promise<Ticket[]> {
  const all = await (await getDb()).getAllFromIndex('tickets', 'ownerId', ownerId);
  return all.sort((a, b) => Date.parse(b.service_date) - Date.parse(a.service_date));
}

export async function listOps(ownerId: string): Promise<SyncOp[]> {
  const all = await (await getDb()).getAllFromIndex('sync_queue', 'ownerId', ownerId);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function syncCounts(ownerId: string) {
  const tickets = await listTickets(ownerId);
  return {
    pending: tickets.filter((t) => t.syncStatus === 'pending' || t.syncStatus === 'syncing').length,
    errors: tickets.filter((t) => t.syncStatus === 'error').length,
    total: tickets.length,
  };
}

/** Conflicto → conservar mis cambios: se reenvían sobre la versión actual del servidor. */
export async function resolveKeepMine(id: string, ownerId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['tickets', 'sync_queue'], 'readwrite');
  const t = await tx.objectStore('tickets').get(id);
  if (!t || t.ownerId !== ownerId || !t.conflictRemote) { tx.done.catch(() => {}); tx.abort(); return; }
  const op = await tx.objectStore('sync_queue').index('ticketId').get(id);
  await Promise.all([
    tx.objectStore('tickets').put({
      ...t, version: t.conflictRemote.version, folio: t.conflictRemote.folio, conflictRemote: null,
      syncStatus: 'pending', syncAttempts: 0, lastSyncError: null, lastSyncErrorKind: null,
    }),
    op ? tx.objectStore('sync_queue').put({ ...op, operationType: 'update', attempts: 0, nextAttemptAt: 0, lastError: null }) : Promise.resolve(),
    tx.done,
  ]);
}

/** Conflicto → usar la versión del servidor: se descartan los cambios locales de ese servicio. */
export async function resolveUseServer(id: string, ownerId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['tickets', 'sync_queue'], 'readwrite');
  const t = await tx.objectStore('tickets').get(id);
  if (!t || t.ownerId !== ownerId || !t.conflictRemote) { tx.done.catch(() => {}); tx.abort(); return; }
  const op = await tx.objectStore('sync_queue').index('ticketId').get(id);
  const r = t.conflictRemote;
  await Promise.all([
    tx.objectStore('tickets').put({
      ...t, ...r, conflictRemote: null, syncStatus: 'synced', syncAttempts: 0, lastSyncError: null,
      lastSyncErrorKind: null, serverUpdatedAt: r.updated_at, localVersion: t.localVersion + 1,
    }),
    op ? tx.objectStore('sync_queue').delete(op.operationId) : Promise.resolve(),
    tx.done,
  ]);
}
