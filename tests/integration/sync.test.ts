import { beforeEach, describe, expect, it } from 'vitest';
import { closeDb, getDb, initDb } from '../../src/services/local/db';
import { fromRemote, getTicket, listOps, resolveKeepMine, resolveUseServer, saveAttentionLocal, ValidationFailed } from '../../src/services/local/tickets';
import { SyncEngine, type RemoteRepo } from '../../src/services/sync/engine';
import { pullMyTickets } from '../../src/services/sync/pull';
import { SyncError } from '../../src/services/sync/errors';
import type { AttentionInput, RemoteTicket } from '../../src/domain/types';

const ME = 'tech-a';
const remote = (o: Partial<RemoteTicket> = {}): RemoteTicket => ({
  id: 't1', folio: 'LR-2026-000001', created_by: 'office-1', technician_id: ME, technician_name: 'Técnico A', client_id: 'c1',
  client_pppoe_snapshot: 'cliente.uno', client_name_snapshot: 'Cliente Uno', client_address_snapshot: 'Calle 1', client_reference_snapshot: null,
  external_ticket_ref: null, service_date: '2026-10-21T10:00:00Z', service_type: 'failure', reported_problem: 'Sin internet', diagnosis: null,
  action_taken: null, result: null, service_status: 'assigned', observations: null, pppoe_confirmed: false, address_confirmed: false,
  discrepancy_notes: null, assigned_at: '2026-10-21T10:00:00Z', started_at: null, completed_at: null, created_at: '2026-10-21T10:00:00Z',
  updated_at: '2026-10-21T10:00:00Z', version: 1, last_operation_id: null, ...o,
});
const att = (o: Partial<AttentionInput> = {}): AttentionInput => ({
  status: 'in_progress', pppoe_confirmed: true, address_confirmed: true, discrepancy_notes: null, diagnosis: 'ONT sin potencia',
  action_taken: null, result: null, observations: null, ...o,
});

/** Servidor simulado que reproduce las reglas de save_ticket_attention. */
class FakeServer implements RemoteRepo {
  rows = new Map<string, RemoteTicket>();
  failNext: unknown[] = [];
  loseResponseOnce = false;
  invisible = false;
  applies = 0;
  async getTicket(id: string) { return this.invisible ? null : this.rows.get(id) ?? null; }
  async listMyTickets(uid: string) { return [...this.rows.values()].filter((r) => r.technician_id === uid); }
  async saveAttention(id: string, expected: number, opId: string, i: AttentionInput) {
    const f = this.failNext.shift(); if (f) throw f;
    const cur = this.rows.get(id);
    if (!cur || cur.technician_id !== ME) throw new SyncError('conflict', 'not_assigned', this.invisible ? null : cur ?? null, 'reassigned');
    if (cur.last_operation_id === opId) return cur;
    if (cur.version !== expected) throw new SyncError('conflict', 'version_conflict', cur, 'version');
    if (!['assigned', 'in_progress'].includes(cur.service_status)) throw new SyncError('conflict', 'ticket_closed', cur, 'closed');
    const row: RemoteTicket = { ...cur, pppoe_confirmed: i.pppoe_confirmed, address_confirmed: i.address_confirmed, discrepancy_notes: i.discrepancy_notes,
      diagnosis: i.diagnosis, action_taken: i.action_taken, result: i.result, observations: i.observations, service_status: i.status,
      started_at: cur.started_at ?? 'now', completed_at: i.status === 'completed' ? 'now' : null, version: cur.version + 1, last_operation_id: opId };
    this.rows.set(id, row); this.applies++;
    if (this.loseResponseOnce) { this.loseResponseOnce = false; throw new TypeError('Failed to fetch'); }
    return row;
  }
}

let server: FakeServer, engine: SyncEngine, clock: number, session: string | null, n = 0;
const seed = async (o: Partial<RemoteTicket> = {}) => {
  const r = remote(o);
  server.rows.set(r.id, r);
  await (await getDb()).put('tickets', fromRemote(r, ME));
  return r;
};
const local = async (id = 't1') => (await getTicket(id, ME))!;

beforeEach(async () => {
  await closeDb(); await initDb(`test-${++n}`);
  server = new FakeServer(); clock = 1_000_000; session = ME;
  engine = new SyncEngine(server, async () => session, () => clock);
});

describe('guardado local y cola', () => {
  it('guarda primero en local y deja una operación; el folio y los datos de oficina no cambian', async () => {
    await seed();
    const t = await saveAttentionLocal('t1', ME, att());
    expect(t).toMatchObject({ syncStatus: 'pending', hasLocalChanges: true, folio: 'LR-2026-000001', reported_problem: 'Sin internet', client_address_snapshot: 'Calle 1' });
    expect(await listOps(ME)).toHaveLength(1);
    expect(server.applies).toBe(0);
  });
  it('completar sin datos obligatorios se rechaza y no guarda nada', async () => {
    await seed();
    await expect(saveAttentionLocal('t1', ME, att({ status: 'completed' }))).rejects.toBeInstanceOf(ValidationFailed);
    expect(await listOps(ME)).toHaveLength(0);
    expect((await local()).hasLocalChanges).toBe(false);
  });
  it('sobrevive al cierre y reapertura de la base', async () => {
    await seed(); await saveAttentionLocal('t1', ME, att());
    await closeDb(); await initDb(`test-${n}`);
    expect((await local()).diagnosis).toBe('ONT sin potencia');
    expect(await listOps(ME)).toHaveLength(1);
  });
  it('editar un pendiente reutiliza la misma operación', async () => {
    await seed(); await saveAttentionLocal('t1', ME, att()); await saveAttentionLocal('t1', ME, att({ diagnosis: 'Otro' }));
    expect(await listOps(ME)).toHaveLength(1);
    await engine.run(ME);
    expect(server.rows.get('t1')!.diagnosis).toBe('Otro'); expect(server.applies).toBe(1);
  });
  it('separa datos por propietario', async () => {
    await seed();
    expect(await getTicket('t1', 'otro')).toBeUndefined();
    await expect(saveAttentionLocal('t1', 'otro', att())).rejects.toThrow();
  });
});

describe('sincronización', () => {
  it('marca synced solo tras confirmación del servidor y conserva el folio', async () => {
    await seed(); await saveAttentionLocal('t1', ME, att());
    expect(await engine.run(ME)).toMatchObject({ status: 'done', confirmed: 1 });
    expect(await local()).toMatchObject({ syncStatus: 'synced', hasLocalChanges: false, version: 2, folio: 'LR-2026-000001', service_status: 'in_progress' });
    expect(await listOps(ME)).toHaveLength(0);
  });
  it('sin conexión conserva todo y reintenta con espera progresiva', async () => {
    await seed(); await saveAttentionLocal('t1', ME, att());
    server.failNext.push(new TypeError('Failed to fetch'));
    expect((await engine.run(ME)).status).toBe('stopped-offline');
    const [op] = await listOps(ME);
    expect(op.nextAttemptAt).toBeGreaterThan(clock);
    expect((await local()).syncStatus).toBe('pending');
    expect((await engine.run(ME)).confirmed).toBe(0);
    clock += 10_000;
    expect((await engine.run(ME)).confirmed).toBe(1);
  });
  it('respuesta perdida DESPUÉS de guardar en el servidor: el reintento no vuelve a aplicar', async () => {
    await seed(); await saveAttentionLocal('t1', ME, att());
    server.loseResponseOnce = true;
    await engine.run(ME);
    expect(server.applies).toBe(1);
    clock += 10_000;
    await engine.run(ME);
    expect(server.applies).toBe(1);
    expect(await local()).toMatchObject({ syncStatus: 'synced', version: 2 });
  });
  it('respuesta perdida y el técnico edita antes del reintento: se envía encima, sin conflicto falso', async () => {
    await seed(); await saveAttentionLocal('t1', ME, att());
    server.loseResponseOnce = true;
    await engine.run(ME);
    await saveAttentionLocal('t1', ME, att({ diagnosis: 'Diagnóstico final', action_taken: 'Cambio de ONT' }));
    clock += 10_000;
    await engine.run(ME);
    expect(server.applies).toBe(2);
    expect(server.rows.get('t1')).toMatchObject({ diagnosis: 'Diagnóstico final', version: 3 });
    expect((await local()).syncStatus).toBe('synced');
  });
  it('sesión expirada: detiene el proceso y conserva los datos', async () => {
    await seed(); await saveAttentionLocal('t1', ME, att());
    session = null;
    expect((await engine.run(ME)).status).toBe('no-session');
    session = ME; server.failNext.push({ status: 401, message: 'JWT expired' });
    expect((await engine.run(ME)).status).toBe('stopped-session');
    expect(await listOps(ME)).toHaveLength(1);
    expect((await local()).diagnosis).toBe('ONT sin potencia');
  });
  it('no envía registros de un usuario con la sesión de otro', async () => {
    await seed(); await saveAttentionLocal('t1', ME, att()); session = 'user-b';
    expect((await engine.run(ME)).status).toBe('owner-mismatch'); expect(server.applies).toBe(0);
  });
  it('permiso denegado bloquea reintentos automáticos; "sincronizar ahora" reintenta', async () => {
    await seed(); await saveAttentionLocal('t1', ME, att());
    server.failNext.push({ code: '42501', message: 'forbidden' });
    await engine.run(ME);
    expect(await local()).toMatchObject({ syncStatus: 'error', lastSyncErrorKind: 'permission' });
    clock += 10 * 60_000;
    expect((await engine.run(ME)).confirmed).toBe(0);
    expect((await engine.run(ME, { force: true })).confirmed).toBe(1);
  });
  it('error de validación del servidor no borra nada', async () => {
    await seed(); await saveAttentionLocal('t1', ME, att());
    server.failNext.push(new SyncError('validation', 'completion_requirements'));
    await engine.run(ME);
    expect(await local()).toMatchObject({ syncStatus: 'error', lastSyncErrorKind: 'validation', diagnosis: 'ONT sin potencia' });
  });
  it('edición durante el envío deja pendiente la última versión', async () => {
    await seed(); await saveAttentionLocal('t1', ME, att());
    const orig = server.saveAttention.bind(server);
    server.saveAttention = async (...a) => { await saveAttentionLocal('t1', ME, att({ diagnosis: 'Editado en pleno envío' })); return orig(...a); };
    await engine.run(ME);
    expect(await local()).toMatchObject({ syncStatus: 'pending', diagnosis: 'Editado en pleno envío', version: 2 });
    server.saveAttention = orig;
    await engine.run(ME);
    expect(server.rows.get('t1')!.diagnosis).toBe('Editado en pleno envío');
    expect((await local()).syncStatus).toBe('synced');
  });
  it('recupera operaciones que quedaron en "syncing" tras cerrar la app', async () => {
    await seed(); await saveAttentionLocal('t1', ME, att());
    const db = await getDb(); await db.put('tickets', { ...(await local()), syncStatus: 'syncing' });
    expect((await engine.run(ME)).confirmed).toBe(1);
  });
  it('cerrar el ticket (completado) offline y sincronizar después', async () => {
    await seed(); await saveAttentionLocal('t1', ME, att({ status: 'completed', action_taken: 'Reemplazo', result: 'Restablecido' }));
    server.failNext.push(new TypeError('Failed to fetch')); await engine.run(ME);
    expect((await local()).service_status).toBe('completed'); // visible localmente aunque no confirmado
    clock += 10_000; await engine.run(ME);
    expect(server.rows.get('t1')).toMatchObject({ service_status: 'completed', completed_at: 'now' });
  });
});

describe('conflictos con oficina y otros dispositivos', () => {
  it('oficina edita el ticket mientras el técnico está offline: no se sobrescribe, se presenta el conflicto', async () => {
    await seed(); await saveAttentionLocal('t1', ME, att());
    server.rows.set('t1', { ...server.rows.get('t1')!, reported_problem: 'Problema corregido por oficina', version: 2 });
    await engine.run(ME);
    const t = await local();
    expect(t).toMatchObject({ syncStatus: 'error', diagnosis: 'ONT sin potencia' });
    expect(t.conflict?.reason).toBe('version');
    expect(server.rows.get('t1')!.reported_problem).toBe('Problema corregido por oficina');
    await expect(saveAttentionLocal('t1', ME, att())).rejects.toThrow(/conflicto/);
  });
  it('"conservar mis notas": toma los datos de oficina del servidor y reenvía solo la atención', async () => {
    await seed(); await saveAttentionLocal('t1', ME, att());
    server.rows.set('t1', { ...server.rows.get('t1')!, reported_problem: 'Problema corregido por oficina', version: 2 });
    await engine.run(ME); await resolveKeepMine('t1', ME);
    expect((await local()).reported_problem).toBe('Problema corregido por oficina');
    await engine.run(ME);
    expect(server.rows.get('t1')).toMatchObject({ reported_problem: 'Problema corregido por oficina', diagnosis: 'ONT sin potencia', version: 3 });
  });
  it('dos dispositivos del mismo técnico: el segundo recibe conflicto de versión', async () => {
    await seed(); await saveAttentionLocal('t1', ME, att());
    server.rows.set('t1', { ...server.rows.get('t1')!, diagnosis: 'Desde otro teléfono', version: 2, last_operation_id: 'otro' });
    await engine.run(ME);
    expect((await local()).conflict?.remote?.diagnosis).toBe('Desde otro teléfono');
  });
  it('oficina reasigna el ticket mientras el técnico está offline (el servidor aún lo muestra)', async () => {
    await seed(); await saveAttentionLocal('t1', ME, att());
    server.rows.set('t1', { ...server.rows.get('t1')!, technician_id: 'tech-b', technician_name: 'Técnico B', version: 2 });
    await engine.run(ME);
    const t = await local();
    expect(t.conflict?.reason).toBe('reassigned');
    expect(t.diagnosis).toBe('ONT sin potencia'); // sus notas siguen ahí hasta que decida
    await resolveKeepMine('t1', ME); // no aplica a reasignaciones
    expect((await local()).conflict).not.toBeNull();
  });
  it('reasignado y ya invisible: descartar lo local lo retira del dispositivo', async () => {
    await seed(); await saveAttentionLocal('t1', ME, att());
    server.rows.set('t1', { ...server.rows.get('t1')!, technician_id: 'tech-b' }); server.invisible = true;
    await engine.run(ME);
    expect((await local()).conflict).toMatchObject({ reason: 'reassigned', remote: null });
    await resolveUseServer('t1', ME);
    expect(await getTicket('t1', ME)).toBeUndefined(); expect(await listOps(ME)).toHaveLength(0);
  });
  it('oficina cancela el ticket: conflicto "closed"; descartar adopta la versión del servidor', async () => {
    await seed(); await saveAttentionLocal('t1', ME, att());
    server.rows.set('t1', { ...server.rows.get('t1')!, service_status: 'cancelled', version: 2 });
    await engine.run(ME);
    expect((await local()).conflict?.reason).toBe('closed');
    await resolveUseServer('t1', ME);
    expect(await local()).toMatchObject({ service_status: 'cancelled', syncStatus: 'synced', conflict: null });
  });
});

describe('descarga de tickets del técnico', () => {
  it('descarga asignados, no pisa cambios locales y retira los reasignados sincronizados', async () => {
    await seed({ id: 't1' }); await seed({ id: 't2', folio: 'LR-2026-000002' });
    await saveAttentionLocal('t1', ME, att());
    server.rows.set('t1', { ...server.rows.get('t1')!, reported_problem: 'cambio oficina', version: 2 });
    server.rows.set('t3', remote({ id: 't3', folio: 'LR-2026-000003' }));
    server.rows.set('t2', { ...server.rows.get('t2')!, technician_id: 'tech-b' });
    await pullMyTickets(server, ME);
    expect((await local('t1')).reported_problem).toBe('Sin internet'); // tiene cambios pendientes: no se pisa
    expect(await getTicket('t3', ME)).toBeTruthy();
    expect(await getTicket('t2', ME)).toBeUndefined();
  });
});
