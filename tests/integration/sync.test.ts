import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, initDb } from '../../src/services/local/db';
import { createLocalTicket, getTicket, listOps, resolveKeepMine, resolveUseServer, updateLocalTicket } from '../../src/services/local/tickets';
import { SyncEngine, type RemoteRepo } from '../../src/services/sync/engine';
import { SyncError } from '../../src/services/sync/errors';
import type { RemoteTicket, TicketInput } from '../../src/domain/types';

const OWNER = { id: 'user-a', name: 'Técnico A' };
const input = (o: Partial<TicketInput> = {}): TicketInput => ({
  service_date: '2026-10-21T10:00:00Z', service_type: 'failure', service_status: 'open',
  reported_problem: 'Luz LOS roja', diagnosis: null, action_taken: null, result: null, observations: null, external_ticket_ref: null, ...o,
});

/** Servidor simulado con fallos programables. */
class FakeServer implements RemoteRepo {
  rows = new Map<string, RemoteTicket>();
  seq = 0;
  failNext: unknown[] = [];
  loseResponseOnce = false;
  creates = 0;
  private maybeFail() { const f = this.failNext.shift(); if (f) throw f; }
  async createTicket(t: TicketInput & { id: string; created_by: string; technician_id: string }) {
    this.maybeFail();
    if (this.rows.has(t.id)) return this.rows.get(t.id)!;
    this.creates++;
    const row: RemoteTicket = { ...t, folio: `SRV-2026-${String(++this.seq).padStart(6, '0')}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), version: 1 };
    this.rows.set(t.id, row);
    if (this.loseResponseOnce) { this.loseResponseOnce = false; throw new TypeError('Failed to fetch'); }
    return row;
  }
  async updateTicket(id: string, patch: TicketInput, expected: number) {
    this.maybeFail();
    const cur = this.rows.get(id);
    if (!cur) throw new SyncError('permission', 'x');
    if (cur.version !== expected) throw new SyncError('conflict', 'version_conflict', cur);
    const row = { ...cur, ...patch, version: cur.version + 1, updated_at: new Date().toISOString() };
    this.rows.set(id, row);
    return row;
  }
  async getTicket(id: string) { return this.rows.get(id) ?? null; }
  async listTickets() { return [...this.rows.values()]; }
}

let server: FakeServer;
let engine: SyncEngine;
let clock: number;
let session: string | null;
let n = 0;

beforeEach(async () => {
  await closeDb();
  await initDb(`test-${++n}`);
  server = new FakeServer();
  clock = 1_000_000;
  session = OWNER.id;
  engine = new SyncEngine(server, async () => session, () => clock);
});

describe('guardado local y cola', () => {
  it('guarda primero en local con folio nulo y una operación create', async () => {
    const t = await createLocalTicket(OWNER, input());
    expect(t.folio).toBeNull();
    expect(t.syncStatus).toBe('pending');
    expect((await listOps(OWNER.id)).map((o) => o.operationType)).toEqual(['create']);
  });

  it('la cola y los datos sobreviven a cerrar y reabrir la base', async () => {
    const t = await createLocalTicket(OWNER, input());
    const name = `test-${n}`;
    await closeDb();
    await initDb(name);
    expect(await getTicket(t.id, OWNER.id)).toBeTruthy();
    expect(await listOps(OWNER.id)).toHaveLength(1);
  });

  it('editar un pendiente no crea otra operación ni otro servicio', async () => {
    const t = await createLocalTicket(OWNER, input());
    await updateLocalTicket(t.id, OWNER.id, input({ reported_problem: 'Cambio' }));
    expect(await listOps(OWNER.id)).toHaveLength(1);
    await engine.run(OWNER.id);
    expect(server.rows.get(t.id)!.reported_problem).toBe('Cambio');
    expect(server.creates).toBe(1);
  });

  it('separa datos por propietario', async () => {
    const t = await createLocalTicket(OWNER, input());
    expect(await getTicket(t.id, 'otro-usuario')).toBeUndefined();
    expect(await listOps('otro-usuario')).toHaveLength(0);
  });
});

describe('sincronización', () => {
  it('marca synced solo tras confirmación y guarda el folio del servidor', async () => {
    const t = await createLocalTicket(OWNER, input());
    const r = await engine.run(OWNER.id);
    expect(r).toMatchObject({ status: 'done', confirmed: 1 });
    const s = (await getTicket(t.id, OWNER.id))!;
    expect(s).toMatchObject({ syncStatus: 'synced', folio: 'SRV-2026-000001', version: 1 });
    expect(await listOps(OWNER.id)).toHaveLength(0);
  });

  it('sin conexión conserva todo y reintenta con espera progresiva', async () => {
    const t = await createLocalTicket(OWNER, input());
    server.failNext.push(new TypeError('Failed to fetch'));
    expect((await engine.run(OWNER.id)).status).toBe('stopped-offline');
    const [op] = await listOps(OWNER.id);
    expect(op.attempts).toBe(1);
    expect(op.nextAttemptAt).toBeGreaterThan(clock);
    expect((await getTicket(t.id, OWNER.id))!.syncStatus).toBe('pending');
    // antes de la espera no reintenta
    expect((await engine.run(OWNER.id)).confirmed).toBe(0);
    clock += 10_000;
    expect((await engine.run(OWNER.id)).confirmed).toBe(1);
  });

  it('respuesta perdida tras crear en el servidor: el reintento NO duplica', async () => {
    const t = await createLocalTicket(OWNER, input());
    server.loseResponseOnce = true;
    await engine.run(OWNER.id);
    expect(server.rows.size).toBe(1);
    clock += 10_000;
    await engine.run(OWNER.id);
    expect(server.rows.size).toBe(1);
    expect(server.creates).toBe(1);
    expect((await getTicket(t.id, OWNER.id))!).toMatchObject({ syncStatus: 'synced', folio: 'SRV-2026-000001' });
  });

  it('sesión expirada: detiene el proceso y conserva los datos', async () => {
    const t = await createLocalTicket(OWNER, input());
    session = null;
    expect((await engine.run(OWNER.id)).status).toBe('no-session');
    session = OWNER.id;
    server.failNext.push({ status: 401, message: 'JWT expired' });
    expect((await engine.run(OWNER.id)).status).toBe('stopped-session');
    expect((await getTicket(t.id, OWNER.id))!.syncStatus).toBe('pending');
    expect(await listOps(OWNER.id)).toHaveLength(1);
  });

  it('no envía registros de un usuario con la sesión de otro', async () => {
    await createLocalTicket(OWNER, input());
    session = 'user-b';
    expect((await engine.run(OWNER.id)).status).toBe('owner-mismatch');
    expect(server.rows.size).toBe(0);
  });

  it('permiso denegado: bloquea reintentos automáticos hasta sincronización manual', async () => {
    const t = await createLocalTicket(OWNER, input());
    server.failNext.push({ code: '42501', message: 'row-level security' });
    await engine.run(OWNER.id);
    expect((await getTicket(t.id, OWNER.id))!).toMatchObject({ syncStatus: 'error', lastSyncErrorKind: 'permission' });
    clock += 10 * 60_000;
    expect((await engine.run(OWNER.id)).confirmed).toBe(0); // automático: sigue bloqueado
    expect((await engine.run(OWNER.id, { force: true })).confirmed).toBe(1); // manual: reintenta
  });

  it('error de validación queda en error sin borrar datos', async () => {
    const t = await createLocalTicket(OWNER, input());
    server.failNext.push({ code: '23514', message: 'check violation' });
    await engine.run(OWNER.id);
    expect((await getTicket(t.id, OWNER.id))!).toMatchObject({ syncStatus: 'error', lastSyncErrorKind: 'validation', reported_problem: 'Luz LOS roja' });
  });

  it('edición durante el envío deja una actualización pendiente con la última versión', async () => {
    const t = await createLocalTicket(OWNER, input());
    const orig = server.createTicket.bind(server);
    server.createTicket = async (x) => {
      await updateLocalTicket(t.id, OWNER.id, input({ reported_problem: 'Editado en pleno envío' }));
      return orig(x);
    };
    await engine.run(OWNER.id);
    let cur = (await getTicket(t.id, OWNER.id))!;
    expect(cur.syncStatus).toBe('pending');
    expect((await listOps(OWNER.id))[0].operationType).toBe('update');
    await engine.run(OWNER.id);
    cur = (await getTicket(t.id, OWNER.id))!;
    expect(cur.syncStatus).toBe('synced');
    expect(server.rows.get(t.id)!.reported_problem).toBe('Editado en pleno envío');
    expect(server.rows.size).toBe(1);
  });

  it('recupera operaciones que quedaron en "syncing" tras cerrar la app', async () => {
    const t = await createLocalTicket(OWNER, input());
    const db = await getDb();
    await db.put('tickets', { ...(await db.get('tickets', t.id))!, syncStatus: 'syncing' });
    expect((await engine.run(OWNER.id)).confirmed).toBe(1);
  });
});

describe('conflictos de versión', () => {
  async function syncedTicket() {
    const t = await createLocalTicket(OWNER, input());
    await engine.run(OWNER.id);
    return t;
  }
  it('no sobrescribe en silencio: conserva lo local y guarda la versión remota', async () => {
    const t = await syncedTicket();
    server.rows.set(t.id, { ...server.rows.get(t.id)!, reported_problem: 'Cambio de otro', version: 2 });
    await updateLocalTicket(t.id, OWNER.id, input({ reported_problem: 'Mi cambio' }));
    await engine.run(OWNER.id);
    const c = (await getTicket(t.id, OWNER.id))!;
    expect(c).toMatchObject({ syncStatus: 'error', lastSyncErrorKind: 'conflict', reported_problem: 'Mi cambio' });
    expect(c.conflictRemote?.reported_problem).toBe('Cambio de otro');
    expect(server.rows.get(t.id)!.reported_problem).toBe('Cambio de otro');
  });
  it('resolver "conservar mis cambios" reenvía sobre la versión actual', async () => {
    const t = await syncedTicket();
    server.rows.set(t.id, { ...server.rows.get(t.id)!, version: 2 });
    await updateLocalTicket(t.id, OWNER.id, input({ reported_problem: 'Mi cambio' }));
    await engine.run(OWNER.id);
    await resolveKeepMine(t.id, OWNER.id);
    await engine.run(OWNER.id);
    expect(server.rows.get(t.id)).toMatchObject({ reported_problem: 'Mi cambio', version: 3 });
    expect((await getTicket(t.id, OWNER.id))!.syncStatus).toBe('synced');
  });
  it('resolver "usar versión del servidor" descarta lo local', async () => {
    const t = await syncedTicket();
    server.rows.set(t.id, { ...server.rows.get(t.id)!, reported_problem: 'Servidor', version: 2 });
    await updateLocalTicket(t.id, OWNER.id, input({ reported_problem: 'Mi cambio' }));
    await engine.run(OWNER.id);
    await resolveUseServer(t.id, OWNER.id);
    expect((await getTicket(t.id, OWNER.id))!).toMatchObject({ reported_problem: 'Servidor', syncStatus: 'synced', version: 2 });
    expect(await listOps(OWNER.id)).toHaveLength(0);
  });
  it('un servicio con conflicto no se puede editar hasta resolverlo', async () => {
    const t = await syncedTicket();
    server.rows.set(t.id, { ...server.rows.get(t.id)!, version: 2 });
    await updateLocalTicket(t.id, OWNER.id, input({ reported_problem: 'Mi cambio' }));
    await engine.run(OWNER.id);
    await expect(updateLocalTicket(t.id, OWNER.id, input())).rejects.toThrow(/conflicto/);
  });
});
