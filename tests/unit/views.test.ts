import { describe, expect, it } from 'vitest';
import { clientDetail, clientsView, esc, loginView, printView, shell, techDetail, techHome, type Ctx } from '../../src/app/views';
import { newTicketView, officeHome, remoteDetail, ticketsView, usersView } from '../../src/app/views-office';
import { fromRemote } from '../../src/services/local/tickets';
import type { AppUser, Client, RemoteTicket, Role } from '../../src/domain/types';

const user = (role: Role): AppUser => ({ id: 'u', fullName: 'Ana <b>', role, active: true });
const ctx = (role: Role = 'technician', route = ''): Ctx => ({ user: user(role), sessionValid: true, online: false, syncing: false, route });
const r: RemoteTicket = {
  id: 't1', folio: 'LR-2026-000001', created_by: 'o', technician_id: 'u', technician_name: 'Ana', client_id: 'c1', client_pppoe_snapshot: 'cli.uno',
  client_name_snapshot: 'Cliente <script>x</script>', client_address_snapshot: 'Calle 1', client_reference_snapshot: null, external_ticket_ref: null,
  service_date: '2026-10-21T10:00:00Z', service_type: 'failure', reported_problem: '<script>alert(1)</script>', diagnosis: null, action_taken: null,
  result: null, service_status: 'assigned', observations: null, pppoe_confirmed: false, address_confirmed: false, discrepancy_notes: null,
  assigned_at: '2026-10-21T10:00:00Z', started_at: null, completed_at: null, created_at: '2026-10-21T10:00:00Z', updated_at: '2026-10-21T10:00:00Z', version: 1, last_operation_id: null,
};
const client: Client = { id: 'c1', pppoe_username: 'cli.uno', full_name: 'Cliente', address: 'Calle 1', address_reference: null, contact_phone: null, created_at: '', updated_at: '', version: 1 };

describe('vistas', () => {
  it('escapa HTML de datos en todas las pantallas', () => {
    const t = fromRemote(r, 'u');
    const pages = [techHome(ctx(), { toStart: 1, inProgress: 0, pending: 0, errors: 0 }, [t]), techDetail(ctx(), t), printView(r, '#/'),
      remoteDetail(ctx('dispatcher'), r, [], [], true), clientDetail(ctx(), client, true)];
    for (const html of pages) expect(html).not.toContain('<script>');
    expect(esc('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
  it('separa problema reportado (oficina) de diagnóstico del técnico y no lo rellena', () => {
    const html = techDetail(ctx(), fromRemote({ ...r, reported_problem: 'Sin internet' }, 'u'));
    expect(html).toContain('Problema reportado (oficina)');
    expect(html).toMatch(/name="diagnosis"[^>]*><\/textarea>/); // vacío
    expect(html).toContain('data-intent="start"');
  });
  it('el técnico no ve acciones de oficina ni campos de datos del cliente editables', () => {
    const html = techDetail(ctx(), fromRemote(r, 'u'));
    expect(html).not.toContain('assign-form'); expect(html).not.toContain('name="pppoe_username"'); expect(html).not.toContain('name="technician_id"');
  });
  it('ticket en proceso ofrece guardar avance y completar; completado no ofrece formulario', () => {
    const prog = techDetail(ctx(), fromRemote({ ...r, service_status: 'in_progress' }, 'u'));
    expect(prog).toContain('data-intent="save"'); expect(prog).toContain('data-intent="complete"');
    expect(techDetail(ctx(), fromRemote({ ...r, service_status: 'completed' }, 'u'))).not.toContain('attention-form');
  });
  it('muestra pendiente y no "confirmado" para cambios locales sin sincronizar', () => {
    const t = { ...fromRemote(r, 'u'), syncStatus: 'pending' as const, hasLocalChanges: true };
    const html = techHome(ctx(), { toStart: 1, inProgress: 0, pending: 1, errors: 0 }, [t]);
    expect(html).toContain('Pendiente de sincronizar'); expect(html).not.toContain('Confirmado en el servidor');
  });
  it('conflicto de reasignación: solo ofrece descartar', () => {
    const html = techDetail(ctx(), { ...fromRemote(r, 'u'), syncStatus: 'error', conflict: { reason: 'reassigned', remote: null } });
    expect(html).toContain('use-server'); expect(html).not.toContain('keep-mine'); expect(html).not.toContain('attention-form');
  });
  it('navegación por rol', () => {
    expect(shell(ctx('technician'), '')).not.toContain('#/users');
    expect(shell(ctx('technician'), '')).not.toContain('#/new');
    expect(shell(ctx('dispatcher'), '')).toContain('#/new');
    expect(shell(ctx('dispatcher'), '')).not.toContain('#/users');
    expect(shell(ctx('admin'), '')).toContain('#/users');
  });
  it('pantallas de oficina y administrador renderizan', () => {
    const counts = { unassigned: 2, assigned: 1, in_progress: 0, completed: 5, cancelled: 0 };
    expect(officeHome(ctx('dispatcher'), counts)).toContain('Pendientes de asignar');
    expect(ticketsView(ctx('dispatcher'), [{ id: 'a', full_name: 'Téc' }], {})).toContain('id="ticket-filters"');
    const nv = newTicketView(ctx('dispatcher'), [], { client_id: null, pppoe_username: '', full_name: '', address: '', address_reference: '', contact_phone: '', service_type: 'support', reported_problem: '', external_ticket_ref: '', technician_id: '' }, { reported_problem: 'Describe el problema reportado.' }, null);
    expect(nv).toContain('Describe el problema reportado.'); expect(nv).toContain('folio se genera automáticamente');
    expect(usersView(ctx('admin'), [{ id: 'u', full_name: 'Yo', role: 'admin', active: true }, { id: 'x', full_name: 'Otro', role: 'technician', active: false }], 'u')).toContain('user-create-form');
    expect(remoteDetail(ctx('dispatcher'), { ...r, service_status: 'in_progress' }, [], [], true)).toContain('Motivo de la reasignación');
    expect(remoteDetail(ctx('dispatcher'), { ...r, service_status: 'completed' }, [], [], true)).toContain('reopen-form');
    expect(remoteDetail(ctx('technician'), r, [], [], false)).not.toContain('Acciones de oficina');
  });
  it('login y búsqueda de historial', () => {
    expect(loginView('', '', false)).toContain('Falta configurar Supabase');
    expect(clientsView(ctx())).toContain('requiere conexión');
  });
});
