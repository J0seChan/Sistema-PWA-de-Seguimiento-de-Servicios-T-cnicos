import { ROLE_LABELS, SERVICE_TYPES, TICKET_STATUSES } from '../domain/catalogs';
import { LIMITS, type NewTicketErrors, type NewTicketForm } from '../domain/validation';
import type { Client, RemoteTicket, Technician, TicketStatus, UserRow } from '../domain/types';
import type { TicketEvent } from '../services/remote/office';
import { clientFields, esc, fmtDate, kv, officeRows, shell, statusPill, technicianRows, type Ctx } from './views';

const opts = (map: Record<string, string>, sel: string) =>
  Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
const techOpts = (techs: Technician[], sel: string, blank: string) =>
  `<option value="">${esc(blank)}</option>${techs.map((t) => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${esc(t.full_name)}</option>`).join('')}`;

export function officeHome(ctx: Ctx, c: Record<TicketStatus, number>): string {
  const stat = (s: TicketStatus, label: string) => `<a class="stat glass" href="#/tickets?status=${s}"><b>${c[s]}</b><span>${label}</span></a>`;
  return shell(ctx, `
    <section class="stats stats5" aria-label="Resumen de tickets">
      ${stat('unassigned', 'Pendientes de asignar')}${stat('assigned', 'Asignados')}${stat('in_progress', 'En proceso')}${stat('completed', 'Completados')}${stat('cancelled', 'Cancelados')}
    </section>
    <div class="actions"><a class="btn primary" href="#/new">Crear ticket</a><a class="btn" href="#/tickets">Ver todos los tickets</a></div>
    <p class="muted small">El panel de oficina trabaja en línea: los tickets se crean y asignan directamente en el servidor.</p>`);
}

export function ticketsView(ctx: Ctx, techs: Technician[], f: { q?: string; status?: string; technician_id?: string; from?: string; to?: string }): string {
  return shell(ctx, `
    <form id="ticket-filters" class="filters glass" aria-label="Filtros">
      <label class="full">Folio, PPPoE o cliente<input type="search" name="q" value="${esc(f.q)}" autocomplete="off" /></label>
      <label>Estado<select name="status"><option value="">Todos</option>${opts(TICKET_STATUSES, f.status ?? '')}</select></label>
      <label>Técnico<select name="technician_id">${techOpts(techs, f.technician_id ?? '', 'Todos')}</select></label>
      <label>Desde<input type="date" name="from" value="${esc(f.from)}" /></label>
      <label>Hasta<input type="date" name="to" value="${esc(f.to)}" /></label>
    </form>
    <div id="list" class="stack" aria-live="polite"></div><div id="more-slot"></div>`);
}

export function newTicketView(ctx: Ctx, techs: Technician[], v: NewTicketForm, errors: NewTicketErrors, picked: Client | null): string {
  const e = (k: keyof NewTicketForm) => (errors[k] ? `<span class="err">${esc(errors[k])}</span>` : '');
  const inv = (k: keyof NewTicketForm) => (errors[k] ? 'aria-invalid="true"' : '');
  return shell(ctx, `
    <form id="new-ticket-form" class="card glass stack" novalidate>
      <h2>Crear ticket</h2>
      <fieldset class="stack"><legend>1 · Cliente</legend>
        ${picked ? `<div class="banner">Cliente existente seleccionado. <button type="button" class="linklike" data-action="clear-client">Cambiar o registrar uno nuevo</button></div>` : `
        <label>Buscar cliente existente (PPPoE o nombre)<input type="search" id="client-q" autocomplete="off" placeholder="Escribe para buscar…" /></label>
        <div id="client-matches" class="stack" aria-live="polite"></div>
        <p class="muted small">Si no existe, llena los datos para registrarlo como cliente nuevo.</p>`}
        ${clientFieldsWithErrors(v, errors, !!picked)}
      </fieldset>
      <fieldset class="stack"><legend>2 · Servicio</legend>
        <label>Tipo de servicio<select name="service_type" ${inv('service_type')}>${opts(SERVICE_TYPES, v.service_type)}</select>${e('service_type')}</label>
        <label>Problema reportado por el cliente<textarea name="reported_problem" maxlength="${LIMITS.text}" ${inv('reported_problem')}>${esc(v.reported_problem)}</textarea>${e('reported_problem')}</label>
        <p class="muted small">El diagnóstico lo escribe el técnico en campo; aquí solo se registra lo que reporta el cliente.</p>
        <label>Referencia externa (opcional)<input name="external_ticket_ref" maxlength="${LIMITS.ref}" value="${esc(v.external_ticket_ref)}" ${inv('external_ticket_ref')} />${e('external_ticket_ref')}</label>
      </fieldset>
      <fieldset class="stack"><legend>3 · Asignación</legend>
        <label>Técnico<select name="technician_id">${techOpts(techs, v.technician_id, 'Dejar pendiente de asignación')}</select></label>
      </fieldset>
      <p class="muted small">El folio se genera automáticamente al guardar.</p>
      <button class="btn primary block" type="submit">Crear ticket</button>
    </form>`, '#/');
}

function clientFieldsWithErrors(v: NewTicketForm, errors: NewTicketErrors, locked: boolean): string {
  const html = clientFields({ pppoe_username: v.pppoe_username, full_name: v.full_name, address: v.address, address_reference: v.address_reference, contact_phone: v.contact_phone }, locked);
  const errs = (['pppoe_username', 'address', 'full_name', 'address_reference', 'contact_phone'] as const).filter((k) => errors[k]).map((k) => `<span class="err">${esc(errors[k])}</span>`).join('');
  return html + errs;
}

const EVENT_LABELS: Record<string, string> = {
  created: 'Ticket creado', assigned: 'Asignado', reassigned: 'Reasignado', edited: 'Datos de oficina editados', started: 'Atención iniciada',
  attention_saved: 'Avance registrado', discrepancy_reported: 'Discrepancia de datos reportada', completed: 'Completado', cancelled: 'Cancelado', reopened: 'Reabierto',
};

export function remoteDetail(ctx: Ctx, t: RemoteTicket, events: TicketEvent[], techs: Technician[], canOffice: boolean, backTo = '#/tickets'): string {
  const closed = t.service_status === 'completed' || t.service_status === 'cancelled';
  const hasTech = t.service_status !== 'unassigned';
  const timeline = events.length ? `<ol class="timeline">${events.map((ev) => {
    const reason = typeof ev.details?.reason === 'string' ? ` — ${esc(ev.details.reason)}` : '';
    return `<li><b>${esc(EVENT_LABELS[ev.event_type] ?? ev.event_type)}</b>${reason}<br><span class="muted small">${esc(fmtDate(ev.created_at))}</span></li>`;
  }).join('')}</ol>` : '<p class="muted small">Sin eventos visibles.</p>';
  const office = canOffice ? `
    <section class="card glass stack no-print"><h3>Acciones de oficina</h3>
      ${closed ? '' : `
      <form id="assign-form" class="stack" data-id="${t.id}" data-version="${t.version}" data-status="${t.service_status}">
        <label>${hasTech ? 'Reasignar a' : 'Asignar a'}<select name="technician_id" required>${techOpts(techs, t.technician_id ?? '', 'Selecciona un técnico')}</select></label>
        ${t.service_status === 'in_progress' ? '<label>Motivo de la reasignación (obligatorio: el ticket está en proceso)<input name="reason" maxlength="300" /></label>' : ''}
        <button class="btn primary" type="submit">${hasTech ? 'Reasignar' : 'Asignar'}</button>
      </form>
      <details><summary class="btn small">Editar datos de oficina</summary>
        <form id="office-edit-form" class="stack" data-id="${t.id}" data-version="${t.version}">
          <label>Tipo de servicio<select name="service_type">${opts(SERVICE_TYPES, t.service_type)}</select></label>
          <label>Problema reportado<textarea name="reported_problem" maxlength="${LIMITS.text}">${esc(t.reported_problem)}</textarea></label>
          <label>Referencia externa<input name="external_ticket_ref" maxlength="${LIMITS.ref}" value="${esc(t.external_ticket_ref)}" /></label>
          <button class="btn" type="submit">Guardar cambios</button></form></details>
      <details><summary class="btn small danger">Cancelar ticket</summary>
        <form id="cancel-form" class="stack" data-id="${t.id}" data-version="${t.version}">
          <label>Motivo de la cancelación<input name="reason" maxlength="300" required /></label>
          <button class="btn danger" type="submit">Cancelar ticket</button></form></details>`}
      ${closed ? `<form id="reopen-form" class="stack" data-id="${t.id}" data-version="${t.version}">
        <label>Motivo para reabrir<input name="reason" maxlength="300" required /></label>
        <button class="btn" type="submit">Reabrir ticket</button></form>` : ''}
    </section>` : '';
  return shell(ctx, `
    <section class="card glass stack"><div class="row between"><h2>${esc(t.folio)}</h2>${statusPill(t.service_status)}</div>
      ${kv(officeRows(t))}</section>
    <section class="card glass stack"><h3>Atención del técnico</h3>
      ${t.started_at || t.diagnosis || t.discrepancy_notes ? kv(technicianRows(t)) : '<p class="muted">Aún sin atención registrada.</p>'}</section>
    ${office}
    <section class="card glass stack"><h3>Bitácora</h3>${timeline}</section>
    <div class="actions">${t.client_id ? `<a class="btn" href="#/client/${t.client_id}">Historial del cliente</a>` : ''}<a class="btn" href="#/print/${t.id}">Ficha imprimible</a></div>`, backTo);
}

export function usersView(ctx: Ctx, users: UserRow[], selfId: string, notice = ''): string {
  const roleOpts = (sel: string) => Object.entries(ROLE_LABELS).map(([k, l]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${l}</option>`).join('');
  return shell(ctx, `
    ${notice ? `<div class="banner" role="status">${esc(notice)}</div>` : ''}
    <form id="user-create-form" class="card glass stack" novalidate>
      <h2>Crear usuario</h2>
      <label>Nombre completo<input name="full_name" maxlength="120" required /></label>
      <label>Correo<input name="email" type="email" autocomplete="off" required /></label>
      <label>Contraseña inicial (mínimo 10 caracteres)<input name="password" type="password" autocomplete="new-password" minlength="10" required /></label>
      <label>Rol<select name="role">${roleOpts('technician')}</select></label>
      <button class="btn primary" type="submit">Crear usuario</button>
      <p class="muted small">Se crea mediante una función segura del servidor. Comparte la contraseña inicial por un canal privado.</p>
    </form>
    <h2>Usuarios</h2>
    ${users.map((u) => `
      <form class="item glass user-form" data-id="${u.id}">
        <div class="row between"><span class="title">${esc(u.full_name)}</span><span class="pill ${u.active ? '' : 'danger'}">${u.active ? '● Activo' : '○ Inactivo'}</span></div>
        <div class="row">
          <select name="role" aria-label="Rol de ${esc(u.full_name)}" ${u.id === selfId ? 'disabled' : ''}>${roleOpts(u.role)}</select>
          <select name="active" aria-label="Estado de ${esc(u.full_name)}" ${u.id === selfId ? 'disabled' : ''}><option value="1" ${u.active ? 'selected' : ''}>Activo</option><option value="0" ${u.active ? '' : 'selected'}>Inactivo</option></select>
          <button class="btn small" type="submit" ${u.id === selfId ? 'disabled' : ''}>Guardar</button>
        </div>
        ${u.id === selfId ? '<span class="muted small">Tu propia cuenta no se puede degradar ni desactivar desde aquí.</span>' : ''}
      </form>`).join('')}`);
}
