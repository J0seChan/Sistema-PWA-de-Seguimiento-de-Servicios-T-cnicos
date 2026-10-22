import { SERVICE_STATUSES, SERVICE_TYPES, SYNC_LABELS } from '../domain/catalogs';
import type { FieldErrors } from '../domain/validation';
import { LIMITS } from '../domain/validation';
import type { AppUser, Ticket, TicketInput } from '../domain/types';

export interface Ctx { user: AppUser | null; sessionValid: boolean; online: boolean; syncing: boolean }

export const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const syncClass = (t: Ticket) => (t.syncStatus === 'error' ? 'danger' : t.syncStatus === 'synced' ? '' : 'warn');
export const syncPill = (t: Ticket) => `<span class="pill ${syncClass(t)}">${esc(SYNC_LABELS[t.syncStatus])}</span>`;

export function shell(ctx: Ctx, content: string, backTo?: string): string {
  const u = ctx.user!;
  const conn = ctx.online ? '<span class="pill">● En línea</span>' : '<span class="pill warn">○ Sin conexión</span>';
  const banner = !ctx.sessionValid
    ? `<div class="banner" role="alert">${ctx.online ? 'Tu sesión expiró: inicia sesión para sincronizar. Tus datos siguen guardados en este dispositivo.' : 'Sin sesión activa y sin conexión: puedes consultar y capturar; la sincronización se reanudará al volver la conexión y la sesión.'}${ctx.online ? ' <a href="#/login">Iniciar sesión</a>' : ''}</div>`
    : '';
  return `
    <header class="topbar glass no-print">
      ${backTo ? `<a class="btn small" href="${backTo}" aria-label="Volver">←</a>` : `<div class="avatar" aria-hidden="true">${esc(u.fullName.slice(0, 1).toUpperCase())}</div>`}
      <div class="grow"><div class="brand">Link Redes Servicios</div><div class="muted small">${esc(u.fullName)} · ${esc(u.role === 'technician' ? 'Técnico' : u.role === 'supervisor' ? 'Supervisor' : 'Administrador')}</div></div>
      ${conn}
    </header>
    ${banner}
    <main class="stack">${content}</main>`;
}

export function loginView(notice: string, error: string, configured: boolean): string {
  return `
    <div class="login"><form id="login-form" class="card glass stack" novalidate>
      <div><h1>Link Redes Servicios</h1><p class="muted">Inicia sesión para registrar y consultar servicios.</p></div>
      ${!configured ? '<div class="banner danger" role="alert">Falta configurar Supabase. Crea el archivo .env con la URL y la clave publicable (ver docs/SUPABASE_SETUP.md).</div>' : ''}
      ${notice ? `<div class="banner" role="status">${esc(notice)}</div>` : ''}
      ${error ? `<div class="banner danger" role="alert">${esc(error)}</div>` : ''}
      <label>Correo<input name="email" type="email" autocomplete="username" inputmode="email" required /></label>
      <label>Contraseña<input name="password" type="password" autocomplete="current-password" required /></label>
      <button class="btn primary block" type="submit" ${configured ? '' : 'disabled'}>Entrar</button>
    </form></div>`;
}

export function homeView(ctx: Ctx, c: { pending: number; errors: number; total: number }): string {
  return shell(ctx, `
    <section class="stats" aria-label="Resumen">
      <div class="stat glass"><b>${c.total}</b><span>Servicios</span></div>
      <div class="stat glass"><b>${c.pending}</b><span>Pendientes de sincronizar</span></div>
      <div class="stat glass"><b>${c.errors}</b><span>Con errores</span></div>
    </section>
    <section class="actions">
      <a class="btn primary wide" href="#/new">Nuevo servicio</a>
      <a class="btn" href="#/history">Historial</a>
      <button class="btn" data-action="sync" ${ctx.syncing ? 'disabled' : ''}>${ctx.syncing ? '<span class="spinner">⟳</span> Sincronizando' : 'Sincronizar ahora'}</button>
      <button class="btn danger wide" data-action="logout">Cerrar sesión</button>
    </section>`);
}

const field = (name: string, label: string, control: string, errors: FieldErrors, cls = '') =>
  `<label class="${cls}">${esc(label)}${control}${errors[name as keyof TicketInput] ? `<span class="err" id="e-${name}">${esc(errors[name as keyof TicketInput])}</span>` : ''}</label>`;
const inv = (name: string, errors: FieldErrors) => (errors[name as keyof TicketInput] ? `aria-invalid="true" aria-describedby="e-${name}"` : '');
const opts = (map: Record<string, string>, sel: string) =>
  Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');

export function formView(ctx: Ctx, v: TicketInput, errors: FieldErrors, editing: boolean): string {
  const ta = (n: keyof TicketInput, label: string) =>
    field(n, label, `<textarea name="${n}" maxlength="${LIMITS.text}" ${inv(n, errors)}>${esc(v[n])}</textarea>`, errors, 'full');
  return shell(ctx, `
    <form id="ticket-form" class="card glass form-grid two" novalidate>
      <h2 class="full">${editing ? 'Editar servicio' : 'Nuevo servicio'}</h2>
      ${field('service_date', 'Fecha y hora del servicio', `<input type="datetime-local" name="service_date" value="${esc(toLocalInput(v.service_date))}" ${inv('service_date', errors)} />`, errors)}
      ${field('service_type', 'Tipo de servicio', `<select name="service_type" ${inv('service_type', errors)}>${opts(SERVICE_TYPES, v.service_type)}</select>`, errors)}
      ${field('service_status', 'Estado del servicio', `<select name="service_status" ${inv('service_status', errors)}>${opts(SERVICE_STATUSES, v.service_status)}</select>`, errors)}
      ${field('external_ticket_ref', 'Referencia externa (opcional)', `<input name="external_ticket_ref" maxlength="${LIMITS.ref}" value="${esc(v.external_ticket_ref)}" ${inv('external_ticket_ref', errors)} />`, errors)}
      ${ta('reported_problem', 'Problema reportado')}
      ${ta('diagnosis', 'Diagnóstico')}
      ${ta('action_taken', 'Acción realizada')}
      ${ta('result', 'Resultado')}
      ${ta('observations', 'Observaciones')}
      <p class="muted small full">Para marcar el servicio como completado se requieren diagnóstico, acción realizada y resultado. Se guarda primero en este dispositivo y se sincroniza cuando haya conexión.</p>
      <button class="btn primary block full" type="submit">Guardar servicio</button>
    </form>`, '#/');
}

export function historyView(ctx: Ctx): string {
  return shell(ctx, `
    <form id="filters" class="filters glass" aria-label="Buscar y filtrar">
      <label class="full">Folio<input type="search" name="q" placeholder="SRV-2026-…" autocomplete="off" /></label>
      <label>Desde<input type="date" name="from" /></label>
      <label>Hasta<input type="date" name="to" /></label>
      <label>Tipo<select name="type"><option value="">Todos</option>${opts(SERVICE_TYPES, '')}</select></label>
      <label>Estado<select name="status"><option value="">Todos</option>${opts(SERVICE_STATUSES, '')}</select></label>
      <label class="full">Sincronización<select name="sync"><option value="">Todos</option><option value="pending">Pendientes</option><option value="synced">Confirmados</option><option value="error">Con errores</option></select></label>
    </form>
    <div id="list" class="stack" aria-live="polite"></div>`, '#/');
}

export function listItems(tickets: Ticket[]): string {
  if (!tickets.length) return '<div class="empty glass card"><h3>No hay servicios</h3><p class="muted">Cambia los filtros o registra un nuevo servicio.</p><p><a class="btn primary" href="#/new">Nuevo servicio</a></p></div>';
  return tickets.map((t) => `
    <a class="item glass" href="#/ticket/${t.id}">
      <div class="row between"><span class="title">${esc(t.folio ?? 'Folio pendiente')}</span>${syncPill(t)}</div>
      <div class="row small"><span>${esc(SERVICE_TYPES[t.service_type])}</span><span class="muted">·</span><span>${esc(SERVICE_STATUSES[t.service_status])}</span><span class="muted">·</span><span class="muted">${esc(fmtDate(t.service_date))}</span></div>
      <div class="desc">${esc(t.reported_problem)}</div>
    </a>`).join('');
}

const kv = (rows: [string, string | null][]) =>
  `<dl class="kv">${rows.map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${esc(val || '—')}</dd></div>`).join('')}</dl>`;

const detailRows = (t: Ticket): [string, string | null][] => [
  ['Folio', t.folio ?? 'Se asignará al sincronizar'], ['Fecha del servicio', fmtDate(t.service_date)],
  ['Técnico responsable', t.technicianName || null], ['Tipo de servicio', SERVICE_TYPES[t.service_type]],
  ['Estado del servicio', SERVICE_STATUSES[t.service_status]], ['Referencia externa', t.external_ticket_ref],
  ['Problema reportado', t.reported_problem], ['Diagnóstico', t.diagnosis], ['Acción realizada', t.action_taken],
  ['Resultado', t.result], ['Observaciones', t.observations],
];

export function detailView(ctx: Ctx, t: Ticket): string {
  const r = t.conflictRemote;
  const conflict = r ? `
    <section class="card glass stack" role="alert"><h3>⚠ Este servicio cambió en el servidor</h3>
      <p class="small">Tus cambios siguen guardados. Elige qué versión conservar:</p>
      <div class="diff"><div><b>Tu versión</b><br>${esc(t.reported_problem)}<br><span class="muted">${esc(t.result ?? '')}</span></div><div><b>Servidor</b><br>${esc(r.reported_problem)}<br><span class="muted">${esc(r.result ?? '')}</span></div></div>
      <div class="row"><button class="btn small" data-action="keep-mine" data-id="${t.id}">Conservar mis cambios</button><button class="btn small" data-action="use-server" data-id="${t.id}">Usar la del servidor</button></div>
    </section>` : '';
  const state = t.lastSyncError && t.syncStatus !== 'synced' ? `<p class="small">${esc(t.lastSyncError)}</p>` : '';
  return shell(ctx, `
    ${conflict}
    <section class="card glass stack"><div class="row between"><h2>${esc(t.folio ?? 'Folio pendiente')}</h2>${syncPill(t)}</div>${state}
      ${t.syncStatus === 'synced' ? `<p class="muted small">Última confirmación del servidor: ${esc(fmtDate(t.serverUpdatedAt))}</p>` : '<p class="muted small">Guardado en este dispositivo.</p>'}
      ${kv(detailRows(t))}
    </section>
    <div class="actions">
      ${r ? '' : `<a class="btn" href="#/edit/${t.id}">Editar</a>`}
      <a class="btn primary" href="#/print/${t.id}">Ficha imprimible</a>
    </div>`, '#/history');
}

export function printView(t: Ticket): string {
  return `
    <div class="row no-print" style="margin-bottom:14px"><a class="btn" href="#/ticket/${t.id}">← Volver</a><button class="btn primary" data-action="print">Imprimir o guardar PDF</button></div>
    <article class="sheet">
      <div class="head"><h1>Link Redes · Ficha de servicio técnico</h1><p>Tecnología Salazar Ramos S.A. de C.V.</p></div>
      ${kv(detailRows(t))}
      <p class="note">${t.syncStatus === 'synced' ? 'Registro confirmado en el servidor.' : 'Registro guardado en el dispositivo; aún no confirmado en el servidor y sin folio definitivo.'} Documento informativo generado por Link Redes Servicios; no es un comprobante firmado. Impreso: ${esc(fmtDate(new Date().toISOString()))}.</p>
    </article>`;
}
