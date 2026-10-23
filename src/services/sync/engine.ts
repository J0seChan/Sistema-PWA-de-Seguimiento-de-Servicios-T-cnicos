import { getDb } from '../local/db';
import { ATTENTION_KEYS, attentionOf, fromRemote } from '../local/tickets';
import { ERROR_MESSAGES } from '../../domain/catalogs';
import type { AttentionInput, ErrorKind, RemoteTicket, SyncOp, Ticket } from '../../domain/types';
import { backoffDelay } from './backoff';
import { classifyError, SyncError } from './errors';

/** Contrato del repositorio remoto (Supabase en producción, simulado en pruebas). */
export interface RemoteRepo {
  saveAttention(ticketId: string, expectedVersion: number, operationId: string, input: AttentionInput): Promise<RemoteTicket>;
  getTicket(id: string): Promise<RemoteTicket | null>;
  listMyTickets(userId: string): Promise<RemoteTicket[]>;
}

export type RunStatus = 'done' | 'skipped' | 'no-session' | 'owner-mismatch' | 'stopped-offline' | 'stopped-session';
export interface RunResult { status: RunStatus; confirmed: number; failed: number }

const BLOCKED = Number.MAX_SAFE_INTEGER;
const uuid = () => crypto.randomUUID();

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
        if (outcome === 'ok') result.confirmed++; else result.failed++;
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
      if (t?.conflict) continue; // los conflictos solo se resuelven explícitamente
      if (op.nextAttemptAt > this.now()) await tx.objectStore('sync_queue').put({ ...op, nextAttemptAt: 0 });
    }
    await tx.done;
  }

  private async processOp(op: SyncOp): Promise<'ok' | 'fail' | 'stop-offline' | 'stop-session'> {
    const db = await getDb();
    const ticket = await db.get('tickets', op.ticketId);
    if (!ticket) { await db.delete('sync_queue', op.operationId); return 'ok'; }
    const sentVersion = ticket.localVersion;

    try {
      let baseVersion = ticket.version;
      if (op.attemptOperationId) {
        // Hubo un intento previo con resultado incierto: ¿el servidor ya lo aplicó?
        const remote0 = await this.repo.getTicket(ticket.id);
        if (remote0 && remote0.last_operation_id === op.attemptOperationId) {
          if (op.attemptLocalVersion === ticket.localVersion) {
            await this.commitSuccess(op.operationId, ticket.id, sentVersion, remote0);
            return 'ok'; // la respuesta se perdió pero el cambio sí se guardó: no se reenvía
          }
          baseVersion = remote0.version; // se aplicó, pero el técnico editó después: se envía encima
        }
      }
      const attemptId = uuid();
      await this.mark(op, ticket, attemptId, sentVersion);
      const remote = await this.repo.saveAttention(ticket.id, baseVersion, attemptId, attentionOf(ticket));
      await this.commitSuccess(op.operationId, ticket.id, sentVersion, remote);
      return 'ok';
    } catch (err) {
      const kind: ErrorKind = classifyError(err);
      const se = err instanceof SyncError ? err : null;
      await this.commitFailure(op.operationId, ticket.id, kind, se?.remote ?? null, se?.reason ?? null);
      if (kind === 'offline') return 'stop-offline';
      if (kind === 'session') return 'stop-session';
      return 'fail';
    }
  }

  private async mark(op: SyncOp, ticket: Ticket, attemptId: string, sentVersion: number) {
    const db = await getDb();
    const tx = db.transaction(['tickets', 'sync_queue'], 'readwrite');
    await Promise.all([
      tx.objectStore('tickets').put({ ...ticket, syncStatus: 'syncing', lastSyncAttemptAt: this.now() }),
      tx.objectStore('sync_queue').put({ ...op, attempts: op.attempts + 1, attemptOperationId: attemptId, attemptLocalVersion: sentVersion }),
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
    if (t.localVersion === sentVersion) {
      await Promise.all([
        tx.objectStore('tickets').put({ ...fromRemote(remote, t.ownerId), localVersion: t.localVersion }),
        tx.objectStore('sync_queue').delete(opId),
        tx.done,
      ]);
    } else {
      // El técnico siguió editando durante el envío: se conserva lo local y queda otra operación pendiente.
      const mine = Object.fromEntries(ATTENTION_KEYS.map((k) => [k, t[k]]));
      await Promise.all([
        tx.objectStore('tickets').put({ ...t, ...remote, ...mine, serverUpdatedAt: remote.updated_at, syncStatus: 'pending',
          syncAttempts: 0, lastSyncError: null, lastSyncErrorKind: null, hasLocalChanges: true }),
        op ? tx.objectStore('sync_queue').put({ ...op, attempts: 0, nextAttemptAt: 0, lastError: null, payloadVersion: t.localVersion,
          attemptOperationId: null, attemptLocalVersion: null }) : Promise.resolve(),
        tx.done,
      ]);
    }
  }

  /** Nunca borra datos locales: solo reprograma o bloquea según el tipo de error. */
  private async commitFailure(opId: string, ticketId: string, kind: ErrorKind, remote: RemoteTicket | null, reason: import('../../domain/types').ConflictReason | null) {
    const db = await getDb();
    const tx = db.transaction(['tickets', 'sync_queue'], 'readwrite');
    const t = await tx.objectStore('tickets').get(ticketId);
    const op = await tx.objectStore('sync_queue').get(opId);
    if (!t || !op) { await tx.done; return; }
    const retryable = kind === 'offline' || kind === 'temporary' || kind === 'session';
    const nextAttemptAt = retryable ? (kind === 'session' ? 0 : this.now() + backoffDelay(op.attempts)) : BLOCKED;
    let conflict = t.conflict;
    if (kind === 'conflict') {
      // La razón se deduce del estado real del servidor (el servidor revisa la versión antes que el estado).
      const r: import('../../domain/types').ConflictReason = remote && remote.technician_id !== t.ownerId ? 'reassigned'
        : remote && !['assigned', 'in_progress'].includes(remote.service_status) ? 'closed' : reason ?? 'version';
      conflict = { reason: r, remote };
    }
    await Promise.all([
      tx.objectStore('tickets').put({ ...t, syncStatus: retryable ? 'pending' : 'error', syncAttempts: op.attempts,
        lastSyncError: ERROR_MESSAGES[kind], lastSyncErrorKind: kind, conflict }),
      tx.objectStore('sync_queue').put({ ...op, nextAttemptAt, lastError: ERROR_MESSAGES[kind] }),
      tx.done,
    ]);
  }
}
