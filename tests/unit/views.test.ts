import { describe, expect, it } from 'vitest';
import { detailView, esc, formView, historyView, homeView, listItems, loginView, printView, type Ctx } from '../../src/app/views';
import type { Ticket } from '../../src/domain/types';

const ctx: Ctx = { user: { id: 'u', fullName: 'Ana <b>', role: 'technician', active: true }, sessionValid: true, online: false, syncing: false };
const t = {
  id: 't1', folio: null, service_date: '2026-10-21T10:00:00Z', service_type: 'failure', service_status: 'open',
  reported_problem: '<script>alert(1)</script>', diagnosis: null, action_taken: null, result: null, observations: null,
  external_ticket_ref: null, technicianName: 'Ana', syncStatus: 'pending', conflictRemote: null, lastSyncError: null, serverUpdatedAt: null,
} as unknown as Ticket;

describe('vistas', () => {
  it('escapa HTML en datos del usuario', () => {
    expect(esc('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
    for (const html of [detailView(ctx, t), listItems([t]), printView(t), homeView(ctx, { pending: 1, errors: 0, total: 1 })]) {
      expect(html).not.toContain('<script>');
    }
  });
  it('muestra "pendiente" y no "confirmado" para registros locales', () => {
    expect(listItems([t])).toContain('Pendiente de sincronizar');
    expect(listItems([t])).not.toContain('Confirmado en el servidor');
    expect(printView(t)).toContain('aún no confirmado');
  });
  it('historial vacío invita a crear un servicio; todas las pantallas renderizan', () => {
    expect(listItems([])).toContain('No hay servicios');
    expect(historyView(ctx)).toContain('id="filters"');
    expect(formView(ctx, t, { reported_problem: 'Describe el problema reportado.' }, false)).toContain('aria-invalid="true"');
    expect(loginView('', '', false)).toContain('Falta configurar Supabase');
    expect(homeView(ctx, { pending: 2, errors: 1, total: 3 })).toContain('Sin conexión');
  });
});
