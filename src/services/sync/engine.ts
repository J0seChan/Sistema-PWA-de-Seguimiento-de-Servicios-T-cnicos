import { getDb } from '../local/db';
import { ERROR_MESSAGES } from '../../domain/catalogs';
import type { ErrorKind, RemoteTicket, SyncOp, Ticket, TicketInput } from '../../domain/types';
import { backoffDelay } from './backoff';
import { classifyError, SyncError } from './errors';

/** Contrato del repositorio remoto (Supabase en producción, simulado en pruebas). */
export interface RemoteRepo {
  createTicket(t: TicketInput & { id: string; created_by: string; technician_id: string }): Promise<RemoteTicket>;
  updateTicket(id: string, patch: TicketInput, expectedVersion: number): Promise<RemoteTicket>;
  getTicket(id: string): Promise<RemoteTicket | null>;
  listTickets(): Promise<RemoteTicket[]>;
}

export type RunStatus = 'done' | 'skipped' | 'no-session' | 'owner-mismatch' | 'stopped-offline' | 'stopped-session';
export interface RunResult { status: RunStatus; confirmed: number; failed: number }

const BLOCKED = Number.MAX_SAFE_INTEGER;

export const toInput = (t: Ticket): TicketInput => ({
  service_date: t.service_date, service_type: t.service_type, reported_problem: t.reported_problem,
  diagnosis: t.diagnosis, action_taken: t.action_taken, result: t.result, service_status: t.service_status,
  observations: t.observations, external_ticket_ref: t.external_ticket_ref,
});

export class SyncEngine {
  private running = false;
  private recovered = new Set<string>();
  private listeners = new Set<() => void>();

  constructor(
    private repo: RemoteRepo,
    private getSessionUserId: () => Promise<string | null>,
    private now: () => number = Date.now,
  ) {}

  onChange(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { this.listeners.forEach((f) => f()); }
  get isRunning() { return this.running; }

  /** Si la app se cerró en pleno envío, los "syncing" vuelven a "pending". */
  private async recoverInterrupted(ownerId: string) {
    if (this.recovered.has(ownerId)) return;
    const db = await getDb();
    const tx = db.transaction('tickets', 'readwrite');
    for (const t of await tx.store.index('ownerId').getAll(ownerId)) {
      if (t.syncStatus === 'syncing') await tx.store.put({ ...t, syncStatus: 'pending' });
    }
    await tx.done;
    this.recovered.add(ownerId);
  }

  /** `force` = acción manual: reactiva operaciones bloqueadas (permisos, validación, errores desconocidos). */
  async run(ownerId: string, opts: { force?: boolean } = {}): Promise<RunResult> {
    if (this.running) return { status: 'skipped', confirmed: 0, failed: 0 };
    this.running = true;
    this.emit();
    const result: RunResult = { status: 'done', confirmed: 0, failed: 0 };
    try {
      const uid = await this.getSessionUserId();
      if (!uid) return { ...result, status: 'no-session' };
      if (uid !== ownerId) return { ...result, status: 'owner-mismatch' };
      await this.recoverInterrupted(ownerId);
      if (opts.force) await this.unblock(ownerId);

      const db = await getDb();
      const ops = (await db.getAllFromIndex('sync_queue', 'ownerId', ownerId)).sort((a, b) => a.createdAt - b.createdAt);
      for (const op of ops) {
        if (op.nextAttemptAt > this.now()) continue;
        const outcome = await this.processOp(op);
        this.emit();
        if (outcome === 'ok') result.confirmed++;
        else result.failed++;
        if (outcome === 'stop-offline') { result.status = 'stopped-offline'; break; }
        if (outcome === 'stop-session') { result.status = 'stopped-session'; break; }
      }
      return result;
    } finally {
      this.running = false;
      this.emit();
    }
  }

  private async unblock(ownerId: string) {
    const db = await getDb();
    const tx = db.transaction(['tickets', 'sync_queue'], 'readwrite');
    for (const op of await tx.objectStore('sync_queue').index('ownerId').getAll(ownerId)) {
      const t = await tx.objectStore('tickets').get(op.ticketId);
      if (t?.conflictRemote) continue; // los conflictos solo se resuelven explícitamente
      if (op.nextAttemptAt > this.now()) await tx.objectStore('sync_queue').put({ ...op, nextAttemptAt: 0 });
    }
    await tx.done;
  }

  private async processOp(op: SyncOp): Promise<'ok' | 'fail' | 'stop-offline' | 'stop-session'> {
    const db = await getDb();
    const ticket = await db.get('tickets', op.ticketId);
    if (!ticket) { await db.delete('sync_queue', op.operationId); return 'ok'; }

    const sentVersion = ticket.localVersion;
    const previousAttempts = op.attempts;
    await this.mark(op, ticket, { syncing: true });

    try {
      let remote: RemoteTicket | null = null;
      if (op.operationType === 'create') {
        // Respuesta incierta de un intento previo: comprobar si el servidor ya lo creó.
        if (previousAttempts > 0) remote = await this.repo.getTicket(ticket.id);
        if (!remote) remote = await this.repo.createTicket({ ...toInput(ticket), id: ticket.id, created_by: ticket.created_by, technician_id: ticket.technician_id });
      } else {
        remote = await this.repo.updateTicket(ticket.id, toInput(ticket), ticket.version);
      }
      await this.commitSuccess(op.operationId, ticket.id, sentVersion, remote);
      return 'ok';
    } catch (err) {
      const kind: ErrorKind = classifyError(err);
      await this.commitFailure(op.operationId, ticket.id, kind, err instanceof SyncError ? err.remote : null);
      if (kind === 'offline') return 'stop-offline';
      if (kind === 'session') return 'stop-session';
      return 'fail';
    }
  }

  private async mark(op: SyncOp, ticket: Ticket, o: { syncing: boolean }) {
    const db = await getDb();
    const tx = db.transaction(['tickets', 'sync_queue'], 'readwrite');
    await Promise.all([
      tx.objectStore('tickets').put({ ...ticket, syncStatus: o.syncing ? 'syncing' : ticket.syncStatus, lastSyncAttemptAt: this.now() }),
      tx.objectStore('sync_queue').put({ ...op, attempts: op.attempts + 1 }),
      tx.done,
    ]);
  }

  /** Solo aquí, tras confirmación válida del servidor, un registro pasa a "synced". */
  private async commitSuccess(opId: string, ticketId: string, sentVersion: number, remote: RemoteTicket) {
    const db = await getDb();
    const tx = db.transaction(['tickets', 'sync_queue'], 'readwrite');
    const t = await tx.objectStore('tickets').get(ticketId);
    const op = await tx.objectStore('sync_queue').get(opId);
    if (!t) { await tx.done; return; }
    const confirmedFields = {
      folio: remote.folio, version: remote.version, created_at: remote.created_at,
      updated_at: remote.updated_at, serverUpdatedAt: remote.updated_at,
    };
    if (t.localVersion === sentVersion) {
      await Promise.all([
        tx.objectStore('tickets').put({ ...t, ...confirmedFields, syncStatus: 'synced', syncAttempts: 0, lastSyncError: null, lastSyncErrorKind: null }),
        tx.objectStore('sync_queue').delete(opId),
        tx.done,
      ]);
    } else {
      // El técnico editó mientras se enviaba: queda pendiente una actualización con la última versión.
      await Promise.all([
        tx.objectStore('tickets').put({ ...t, ...confirmedFields, syncStatus: 'pending', syncAttempts: 0, lastSyncError: null, lastSyncErrorKind: null }),
        op ? tx.objectStore('sync_queue').put({ ...op, operationType: 'update', attempts: 0, nextAttemptAt: 0, lastError: null, payloadVersion: t.localVersion }) : Promise.resolve(),
        tx.done,
      ]);
    }
  }

  /** Nunca borra datos locales: solo reprograma o bloquea según el tipo de error. */
  private async commitFailure(opId: string, ticketId: string, kind: ErrorKind, remote: RemoteTicket | null) {
    const db = await getDb();
    const tx = db.transaction(['tickets', 'sync_queue'], 'readwrite');
    const t = await tx.objectStore('tickets').get(ticketId);
    const op = await tx.objectStore('sync_queue').get(opId);
    if (!t || !op) { await tx.done; return; }
    const msg = ERROR_MESSAGES[kind];
    const retryable = kind === 'offline' || kind === 'temporary' || kind === 'session';
    const nextAttemptAt = retryable ? (kind === 'session' ? 0 : this.now() + backoffDelay(op.attempts)) : BLOCKED;
    await Promise.all([
      tx.objectStore('tickets').put({
        ...t,
        syncStatus: retryable ? 'pending' : 'error',
        syncAttempts: op.attempts,
        lastSyncError: msg,
        lastSyncErrorKind: kind,
        conflictRemote: kind === 'conflict' ? remote : t.conflictRemote,
      }),
      tx.objectStore('sync_queue').put({ ...op, nextAttemptAt, lastError: msg }),
      tx.done,
    ]);
  }
}
