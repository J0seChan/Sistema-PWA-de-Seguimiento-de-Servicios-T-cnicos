import { ROLE_LABELS, SERVICE_TYPES, SYNC_LABELS, TICKET_STATUSES, isOffice } from '../domain/catalogs';
import type { AttentionErrors } from '../domain/validation';
import { LIMITS } from '../domain/validation';
import type { AppUser, Client, RemoteTicket, Ticket, TicketStatus } from '../domain/types';

export interface Ctx { user: AppUser | null; sessionValid: boolean; online: boolean; syncing: boolean; route: string }

export const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const statusClass = (s: TicketStatus) => (s === 'completed' ? '' : s === 'cancelled' ? 'danger' : 'warn');
export const statusPill = (s: TicketStatus) => `<span class="pill ${statusClass(s)}">${esc(TICKET_STATUSES[s])}</span>`;
const syncClass = (t: Ticket) => (t.syncStatus === 'error' ? 'danger' : t.syncStatus === 'synced' ? '' : 'warn');
export const syncPill = (t: Ticket) => `<span class="pill ${syncClass(t)}">${esc(SYNC_LABELS[t.syncStatus])}</span>`;

export function shell(ctx: Ctx, content: string, backTo?: string): string {
  const u = ctx.user!;
  const office = isOffice(u.role);
  const links: [string, string][] = office
    ? [['', 'Panel'], ['tickets', 'Tickets'], ['new', 'Nuevo'], ['clients', 'Clientes'], ...(u.role === 'admin' ? [['users', 'Usuarios'] as [string, string]] : [])]
    : [['', 'Mis tickets'], ['clients', 'Historial de clientes']];
  const nav = links.map(([r, l]) => `<a href="#/${r}" ${ctx.route === r ? 'aria-current="page"' : ''}>${l}</a>`).join('');
  const conn = ctx.online ? '<span class="pill">● En línea</span>' : '<span class="pill warn">○ Sin conexión</span>';
  const banner = !ctx.sessionValid
    ? `<div class="banner" role="alert">${ctx.online ? 'Tu sesión expiró: inicia sesión para sincronizar. Tus datos siguen guardados en este dispositivo.' : 'Sin sesión activa y sin conexión: puedes consultar y capturar; la sincronización se reanudará al volver la conexión y la sesión.'}${ctx.online ? ' <a href="#/login">Iniciar sesión</a>' : ''}</div>`
    : '';
  return `
    <header class="topbar glass no-print">
      ${backTo ? `<a class="btn small" href="${backTo}" aria-label="Volver">←</a>` : `<div class="avatar" aria-hidden="true">${esc(u.fullName.slice(0, 1).toUpperCase())}</div>`}
      <div class="grow"><div class="brand">Link Redes Servicios</div><div class="muted small">${esc(u.fullName)} · ${esc(ROLE_LABELS[u.role])}</div></div>
      ${conn}
    </header>
    <nav class="nav glass no-print" aria-label="Secciones">${nav}<button class="linklike" data-action="logout">Salir</button></nav>
    ${banner}
    <main class="stack">${content}</main>`;
}

export function loginView(notice: string, error: string, configured: boolean): string {
  return `
    <div class="login"><form id="login-form" class="card glass stack" novalidate>
      <div><h1>Link Redes Servicios</h1><p class="muted">Inicia sesión para continuar.</p></div>
      ${!configured ? '<div class="banner danger" role="alert">Falta configurar Supabase. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (ver docs/SUPABASE_SETUP.md).</div>' : ''}
      ${notice ? `<div class="banner" role="status">${esc(notice)}</div>` : ''}
      ${error ? `<div class="banner danger" role="alert">${esc(error)}</div>` : ''}
      <label>Correo<input name="email" type="email" autocomplete="username" inputmode="email" required /></label>
      <label>Contraseña<input name="password" type="password" autocomplete="current-password" required /></label>
      <button class="btn primary block" type="submit" ${configured ? '' : 'disabled'}>Entrar</button>
    </form></div>`;
}

export const msgCard = (title: string, text = '', extra = '') =>
  `<div class="empty glass card"><h3>${esc(title)}</h3>${text ? `<p class="muted">${esc(text)}</p>` : ''}${extra}</div>`;
export const needsConnection = () => msgCard('Esta sección necesita conexión', 'Se descarga directamente del servidor. Vuelve a intentarlo cuando tengas Internet.');

export const kv = (rows: [string, string | null | undefined][]) =>
  `<dl class="kv">${rows.map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${esc(val || '—')}</dd></div>`).join('')}</dl>`;

/** Datos originales que capturó oficina (el técnico nunca los edita). */
export const officeRows = (t: RemoteTicket): [string, string | null][] => [
  ['Folio', t.folio], ['Cliente', t.client_name_snapshot], ['Usuario PPPoE', t.client_pppoe_snapshot],
  ['Dirección registrada', t.client_address_snapshot], ['Referencias del domicilio', t.client_reference_snapshot],
  ['Tipo de servicio', SERVICE_TYPES[t.service_type]], ['Referencia externa', t.external_ticket_ref],
  ['Técnico asignado', t.technician_name ?? 'Sin asignar'], ['Fecha de asignación', t.assigned_at ? fmtDate(t.assigned_at) : null],
  ['Problema reportado (oficina)', t.reported_problem],
];
export const technicianRows = (t: RemoteTicket): [string, string | null][] => [
  ['PPPoE confirmado en campo', t.pppoe_confirmed ? 'Sí' : 'No'], ['Dirección confirmada en campo', t.address_confirmed ? 'Sí' : 'No'],
  ['Diferencias encontradas', t.discrepancy_notes], ['Diagnóstico real (técnico)', t.diagnosis], ['Acción realizada', t.action_taken],
  ['Resultado', t.result], ['Observaciones', t.observations], ['Iniciado', t.started_at ? fmtDate(t.started_at) : null], ['Completado', t.completed_at ? fmtDate(t.completed_at) : null],
];

/* ---------------- Técnico ---------------- */
export function ticketCard(t: Ticket): string {
  return `
    <a class="item glass" href="#/ticket/${t.id}">
      <div class="row between"><span class="title">${esc(t.folio)}</span>${statusPill(t.service_status)}</div>
      <div class="small"><b>${esc(t.client_name_snapshot || t.client_pppoe_snapshot)}</b> · <span class="muted">${esc(t.client_pppoe_snapshot)}</span></div>
      <div class="small muted">${esc(SERVICE_TYPES[t.service_type])} · ${esc(t.client_address_snapshot)}</div>
      <div class="desc">${esc(t.reported_problem)}</div>
      <div class="row">${syncPill(t)}</div>
    </a>`;
}

export function techHome(ctx: Ctx, c: { toStart: number; inProgress: number; pending: number; errors: number }, tickets: Ticket[]): string {
  return shell(ctx, `
    <section class="stats" aria-label="Resumen">
      <div class="stat glass"><b>${c.toStart}</b><span>Por iniciar</span></div>
      <div class="stat glass"><b>${c.inProgress}</b><span>En proceso</span></div>
      <div class="stat glass"><b>${c.pending}${c.errors ? ` · ⚠${c.errors}` : ''}</b><span>Por sincronizar</span></div>
    </section>
    <section class="actions">
      <button class="btn primary wide" data-action="sync" ${ctx.syncing ? 'disabled' : ''}>${ctx.syncing ? '<span class="spinner">⟳</span> Sincronizando' : 'Sincronizar ahora'}</button>
    </section>
    <h2>Mis tickets</h2>
    ${tickets.length ? tickets.map(ticketCard).join('') : msgCard('No tienes tickets asignados', 'Cuando oficina te asigne uno aparecerá aquí al sincronizar.')}`);
}

export function techDetail(ctx: Ctx, t: Ticket, errors: AttentionErrors = {}, draft?: Partial<Ticket>): string {
  const v = { ...t, ...draft };
  const open = t.service_status === 'assigned' || t.service_status === 'in_progress';
  const c = t.conflict;
  const conflict = c ? `
    <section class="card glass stack" role="alert"><h3>⚠ ${c.reason === 'reassigned' ? 'Este ticket fue reasignado o ya no es tuyo' : c.reason === 'closed' ? 'Oficina cerró o canceló este ticket' : 'Oficina modificó este ticket'}</h3>
      <p class="small">Tus notas siguen guardadas en este dispositivo y no se han perdido.${c.reason === 'version' ? ' Puedes conservarlas y reenviarlas sobre la versión actual (los datos de oficina se actualizan).' : ' Copia lo que necesites antes de descartar.'}</p>
      ${c.remote ? `<div class="diff"><div><b>Tu versión</b><br>${esc(t.diagnosis ?? '—')}<br><span class="muted">${esc(t.result ?? '')}</span></div><div><b>Servidor (${esc(TICKET_STATUSES[c.remote.service_status])})</b><br>${esc(c.remote.technician_name ?? '')}<br><span class="muted">${esc(c.remote.reported_problem)}</span></div></div>` : '<p class="small muted">El servidor ya no te muestra este ticket.</p>'}
      <div class="row">${c.reason === 'version' ? `<button class="btn small" data-action="keep-mine" data-id="${t.id}">Conservar mis notas</button>` : ''}<button class="btn small danger" data-action="use-server" data-id="${t.id}">Descartar mis cambios</button></div>
    </section>` : '';
  const err = (k: keyof AttentionErrors) => (errors[k] ? `<span class="err" id="e-${k}">${esc(errors[k])}</span>` : '');
  const inv = (k: keyof AttentionErrors) => (errors[k] ? `aria-invalid="true" aria-describedby="e-${k}"` : '');
  const ta = (k: 'diagnosis' | 'action_taken' | 'result' | 'observations', label: string) =>
    `<label>${label}<textarea name="${k}" maxlength="${LIMITS.text}" ${inv(k)}>${esc(v[k])}</textarea>${err(k)}</label>`;
  const form = open && !c ? `
    <form id="attention-form" class="card glass stack" data-id="${t.id}" novalidate>
      <h2>Atención en campo</h2>
      <label class="check"><input type="checkbox" name="pppoe_confirmed" ${v.pppoe_confirmed ? 'checked' : ''}/> Confirmé que el usuario PPPoE coincide</label>
      <label class="check"><input type="checkbox" name="address_confirmed" ${v.address_confirmed ? 'checked' : ''}/> Confirmé que la dirección real coincide</label>
      <label>Diferencias encontradas (si PPPoE o dirección no coinciden)<textarea name="discrepancy_notes" maxlength="${LIMITS.text}" ${inv('discrepancy_notes')}>${esc(v.discrepancy_notes)}</textarea>${err('discrepancy_notes')}</label>
      <p class="muted small">Los datos originales de oficina no se modifican: las diferencias quedan registradas aparte.</p>
      ${ta('diagnosis', 'Diagnóstico real')}${ta('action_taken', 'Acción realizada')}${ta('result', 'Resultado')}${ta('observations', 'Observaciones')}
      <div class="actions">
        ${t.service_status === 'assigned' ? '<button class="btn primary wide" type="submit" data-intent="start">Iniciar atención</button>' : ''}
        ${t.service_status === 'in_progress' ? '<button class="btn" type="submit" data-intent="save">Guardar avance</button>' : ''}
        <button class="btn ${t.service_status === 'in_progress' ? 'primary' : ''}" type="submit" data-intent="complete">Completar servicio</button>
      </div>
      <p class="muted small">Se guarda primero en este dispositivo y se sincroniza cuando haya conexión.</p>
    </form>` : '';
  const state = t.lastSyncError && t.syncStatus !== 'synced' && !c ? `<p class="small">${esc(t.lastSyncError)}</p>` : '';
  return shell(ctx, `
    ${conflict}
    <section class="card glass stack"><div class="row between"><h2>${esc(t.folio)}</h2>${statusPill(t.service_status)}</div>
      <div class="row">${syncPill(t)}</div>${state}
      ${kv(officeRows(t))}
    </section>
    ${open ? '' : `<section class="card glass stack"><h3>Atención registrada</h3>${kv(technicianRows(t))}</section>`}
    ${form}
    <div class="actions">
      ${t.client_id ? `<a class="btn" href="#/client/${t.client_id}">Historial del cliente</a>` : ''}
      <a class="btn" href="#/print/${t.id}">Ficha imprimible</a>
    </div>`, '#/');
}

/* ---------------- Historial de clientes (técnico y oficina) ---------------- */
export function clientsView(ctx: Ctx): string {
  return shell(ctx, `
    <form id="client-search" class="card glass stack" role="search">
      <label>Buscar por usuario PPPoE, nombre del cliente o folio<input type="search" name="q" placeholder="Ej. juan.perez o LR-2026-…" autocomplete="off" /></label>
      <button class="btn primary" type="submit">Buscar</button>
      <p class="muted small">El historial se consulta en el servidor y requiere conexión.</p>
    </form>
    <div id="results" class="stack" aria-live="polite"></div>`);
}

export const clientItem = (c: Client) =>
  `<a class="item glass" href="#/client/${c.id}"><div class="title">${esc(c.full_name || c.pppoe_username)}</div><div class="small muted">${esc(c.pppoe_username)} · ${esc(c.address)}</div></a>`;

export function remoteTicketItem(t: RemoteTicket): string {
  return `
    <a class="item glass" href="#/view/${t.id}">
      <div class="row between"><span class="title">${esc(t.folio)}</span>${statusPill(t.service_status)}</div>
      <div class="small"><b>${esc(t.client_name_snapshot || t.client_pppoe_snapshot)}</b> · <span class="muted">${esc(t.client_pppoe_snapshot)}</span></div>
      <div class="small muted">${esc(SERVICE_TYPES[t.service_type])} · ${esc(t.technician_name ?? 'Sin asignar')} · ${esc(fmtDate(t.created_at))}</div>
      <div class="desc">${esc(t.reported_problem)}</div>
    </a>`;
}
export const moreButton = (visible: boolean) => (visible ? '<button class="btn block" data-action="more">Cargar más</button>' : '');

export function searchResults(clients: Client[], tickets: RemoteTicket[]): string {
  if (!clients.length && !tickets.length) return msgCard('Sin resultados', 'Prueba con otro PPPoE, nombre o folio.');
  return `${clients.length ? `<h3>Clientes</h3>${clients.map(clientItem).join('')}` : ''}${tickets.length ? `<h3>Tickets por folio</h3>${tickets.map(remoteTicketItem).join('')}` : ''}`;
}

export function clientDetail(ctx: Ctx, c: Client, canEdit: boolean): string {
  return shell(ctx, `
    <section class="card glass stack"><h2>${esc(c.full_name || c.pppoe_username)}</h2>
      ${kv([['Usuario PPPoE', c.pppoe_username], ['Dirección', c.address], ['Referencias', c.address_reference], ['Teléfono', c.contact_phone]])}
      ${canEdit ? `<details class="no-print"><summary class="btn small">Editar datos del cliente</summary>
        <form id="client-edit-form" class="stack" data-id="${c.id}" data-version="${c.version}" novalidate>
          ${clientFields(c)}<button class="btn primary" type="submit">Guardar cliente</button>
          <p class="muted small">Los tickets anteriores conservan los datos originales con los que se crearon.</p></form></details>` : ''}
    </section>
    <h2>Historial de servicios</h2>
    <p class="muted small">Se muestran los servicios completados y tus tickets asignados.</p>
    <div id="history-list" class="stack" aria-live="polite"></div><div id="more-slot"></div>`, '#/clients');
}

export const clientFields = (c: Partial<Client>, disabled = false) => {
  const d = disabled ? 'disabled' : '';
  return `
    <label>Usuario PPPoE<input name="pppoe_username" maxlength="${LIMITS.pppoe}" value="${esc(c.pppoe_username)}" ${d} required /></label>
    <label>Nombre del cliente<input name="full_name" maxlength="${LIMITS.name}" value="${esc(c.full_name)}" ${d} /></label>
    <label>Dirección<input name="address" maxlength="${LIMITS.address}" value="${esc(c.address)}" ${d} required /></label>
    <label>Referencias del domicilio<input name="address_reference" maxlength="${LIMITS.address}" value="${esc(c.address_reference)}" ${d} /></label>
    <label>Teléfono (opcional)<input name="contact_phone" inputmode="tel" maxlength="${LIMITS.phone}" value="${esc(c.contact_phone)}" ${d} /></label>`;
};

/* ---------------- Ficha imprimible ---------------- */
export function printView(t: RemoteTicket, backTo: string, syncNote = ''): string {
  return `
    <div class="row no-print" style="margin-bottom:14px"><a class="btn" href="${backTo}">← Volver</a><button class="btn primary" data-action="print">Imprimir o guardar PDF</button></div>
    <article class="sheet">
      <div class="head"><h1>Link Redes · Ficha de servicio técnico</h1><p>Tecnología Salazar Ramos S.A. de C.V.</p></div>
      ${kv(officeRows(t))}
      <h2 style="margin:18px 0 10px">Atención del técnico</h2>
      ${kv(technicianRows(t))}
      <p class="note">Estado: ${esc(TICKET_STATUSES[t.service_status])}. ${esc(syncNote)} Documento informativo generado por Link Redes Servicios; no es un comprobante firmado. Impreso: ${esc(fmtDate(new Date().toISOString()))}.</p>
    </article>`;
}
