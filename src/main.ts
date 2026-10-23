import './styles/main.css';
import { getAuthState, signIn, signOut, type AuthState } from './services/auth/auth';
import { isSupabaseConfigured } from './services/remote/client';
import { getDb, initDb } from './services/local/db';
import { getTicket, listOps, listTickets, resolveKeepMine, resolveUseServer, saveAttentionLocal, syncCounts, ValidationFailed } from './services/local/tickets';
import { engine, syncAll } from './services/sync';
import * as office from './services/remote/office';
import { friendlyError } from './services/remote/office';
import { isOffice } from './domain/catalogs';
import { validateNewTicket, type NewTicketForm } from './domain/validation';
import type { AttentionInput, Client, RemoteTicket, Technician } from './domain/types';
import { clientDetail, clientsView, loginView, moreButton, msgCard, needsConnection, printView, remoteTicketItem, searchResults, shell, techDetail, techHome, type Ctx } from './app/views';
import { newTicketView, officeHome, remoteDetail, ticketsView, usersView } from './app/views-office';

const app = document.getElementById('app')!;
const toastEl = document.getElementById('toast')!;
let auth: AuthState = { user: null, sessionValid: false };
let online = navigator.onLine;
let loginNotice = '';
let toastTimer: number | undefined;
let retryTimer: number | undefined;
let debounce: number | undefined;

/* ---------- Utilidades ---------- */
interface Route { name: string; id: string; query: URLSearchParams }
function parseRoute(): Route {
  const [path, qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [name = '', id = ''] = path.split('/');
  return { name, id, query: new URLSearchParams(qs) };
}
const ctx = (r: Route): Ctx => ({ user: auth.user, sessionValid: auth.sessionValid, online, syncing: engine?.isRunning ?? false, route: r.name });
const isTech = () => auth.user?.role === 'technician';
const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);

function toast(msg: string) {
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => (toastEl.hidden = true), 5000);
}
const formValues = (form: HTMLFormElement) => Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v)])) as Record<string, string>;
const busy = (form: HTMLFormElement, on: boolean) => form.querySelectorAll('button').forEach((b) => (b.disabled = on));

/* ---------- Paginación real (servidor) ---------- */
let pager: { load: (page: number) => Promise<{ rows: RemoteTicket[]; hasMore: boolean }>; page: number; target: string } | null = null;
async function startPager(target: string, load: NonNullable<typeof pager>['load']) {
  pager = { load, page: 0, target };
  const el = $(target); if (el) el.innerHTML = '<p class="muted">Cargando…</p>';
  await loadPage(true);
}
async function loadPage(reset = false) {
  if (!pager) return;
  const el = $(pager.target), slot = $('#more-slot');
  try {
    const { rows, hasMore } = await pager.load(pager.page);
    if (!el) return;
    const html = rows.map(remoteTicketItem).join('');
    el.innerHTML = reset ? (html || msgCard('No hay tickets', 'Cambia los filtros o crea un ticket nuevo.')) : el.innerHTML + html;
    if (slot) slot.innerHTML = moreButton(hasMore);
  } catch (e) { if (el) el.innerHTML = msgCard('No se pudo cargar', friendlyError(e)); if (slot) slot.innerHTML = ''; }
}

/* ---------- Estado del formulario "Crear ticket" ---------- */
const blankNew = (): NewTicketForm => ({ client_id: null, pppoe_username: '', full_name: '', address: '', address_reference: '', contact_phone: '', service_type: 'support', reported_problem: '', external_ticket_ref: '', technician_id: '' });
// El UUID del ticket se genera una vez por formulario: si se reintenta tras un fallo de red, no se duplica.
let newState = { id: crypto.randomUUID(), client: null as Client | null, values: blankNew() };
const resetNew = () => { newState = { id: crypto.randomUUID(), client: null, values: blankNew() }; };
const matchCache = new Map<string, Client>();
let techCache: Technician[] = [];

function readNew(form: HTMLFormElement): NewTicketForm {
  const v = formValues(form), c = newState.client;
  return {
    client_id: c?.id ?? null,
    pppoe_username: c?.pppoe_username ?? v.pppoe_username ?? '', full_name: c?.full_name ?? v.full_name ?? '',
    address: c?.address ?? v.address ?? '', address_reference: c?.address_reference ?? v.address_reference ?? '', contact_phone: c?.contact_phone ?? v.contact_phone ?? '',
    service_type: v.service_type ?? 'support', reported_problem: v.reported_problem ?? '', external_ticket_ref: v.external_ticket_ref ?? '', technician_id: v.technician_id ?? '',
  };
}

/* ---------- Enrutado ---------- */
async function render() {
  const r = parseRoute();
  if (!auth.user || r.name === 'login') {
    if (auth.user && auth.sessionValid) { location.hash = '#/'; return; }
    app.innerHTML = loginView(loginNotice || (auth.user ? 'Tu sesión expiró. Inicia sesión para seguir sincronizando.' : ''), '', isSupabaseConfigured);
    return;
  }
  const c = ctx(r);
  try {
    if (r.name === 'print') await renderPrint(r, c);
    else if (r.name === 'clients') app.innerHTML = clientsView(c);
    else if (r.name === 'client') await renderClient(r, c);
    else if (r.name === 'view') await renderRemote(r, c);
    else if (isOffice(auth.user.role)) await renderOffice(r, c);
    else await renderTech(r, c);
  } catch (e) {
    app.innerHTML = shell(c, msgCard('No se pudo cargar', friendlyError(e), '<p><button class="btn" data-action="retry">Reintentar</button></p>'));
  }
}

async function renderTech(r: Route, c: Ctx) {
  const uid = auth.user!.id;
  if (r.name === 'ticket') {
    const t = await getTicket(r.id, uid);
    app.innerHTML = t ? techDetail(c, t) : shell(c, msgCard('Ticket no encontrado', 'Sincroniza para descargar tus tickets asignados.'), '#/');
    return;
  }
  app.innerHTML = techHome(c, await syncCounts(uid), await listTickets(uid));
}

async function renderOffice(r: Route, c: Ctx) {
  const wrap = (html: string) => (online ? html : shell(c, needsConnection()));
  if (!online && r.name !== '') { app.innerHTML = shell(c, needsConnection()); return; }
  switch (r.name) {
    case 'tickets': {
      techCache = await office.listTechnicians();
      const f = { q: r.query.get('q') ?? '', status: r.query.get('status') ?? '', technician_id: '', from: '', to: '' };
      app.innerHTML = ticketsView(c, techCache, f);
      await startPager('#list', (p) => office.listTicketsPage(f, p));
      break;
    }
    case 'new':
      techCache = await office.listTechnicians();
      app.innerHTML = newTicketView(c, techCache, newState.values, {}, newState.client);
      break;
    case 'users':
      if (auth.user!.role !== 'admin') { location.hash = '#/'; return; }
      app.innerHTML = usersView(c, await office.listUsers(), auth.user!.id);
      break;
    default:
      app.innerHTML = online ? officeHome(c, await office.countByStatus()) : wrap('');
  }
}

async function renderClient(r: Route, c: Ctx) {
  if (!online) { app.innerHTML = shell(c, needsConnection(), '#/clients'); return; }
  const client = await office.getClient(r.id);
  if (!client) { app.innerHTML = shell(c, msgCard('Cliente no encontrado'), '#/clients'); return; }
  app.innerHTML = clientDetail(c, client, isOffice(auth.user!.role));
  await startPager('#history-list', (p) => office.listTicketsPage({ client_id: client.id }, p));
}

async function renderRemote(r: Route, c: Ctx) {
  if (!online) { app.innerHTML = shell(c, needsConnection(), '#/clients'); return; }
  const t = await office.getTicketRemote(r.id);
  if (!t) { app.innerHTML = shell(c, msgCard('Ticket no encontrado', 'Puede que ya no tengas acceso a él.'), '#/clients'); return; }
  const off = isOffice(auth.user!.role);
  const [events, techs] = await Promise.all([office.listEvents(t.id).catch(() => []), off ? office.listTechnicians() : Promise.resolve([] as Technician[])]);
  app.innerHTML = remoteDetail(c, t, events, techs, off, off ? '#/tickets' : '#/clients');
}

async function renderPrint(r: Route, c: Ctx) {
  const local = isTech() ? await getTicket(r.id, auth.user!.id) : undefined;
  if (local) {
    const note = local.syncStatus === 'synced' ? 'Registro confirmado en el servidor.' : 'Cambios guardados en el dispositivo y aún no confirmados en el servidor.';
    app.innerHTML = printView(local, `#/ticket/${r.id}`, note);
    return;
  }
  if (!online) { app.innerHTML = shell(c, needsConnection(), '#/'); return; }
  const t = await office.getTicketRemote(r.id);
  app.innerHTML = t ? printView(t, `#/view/${r.id}`, 'Registro confirmado en el servidor.') : shell(c, msgCard('Ticket no encontrado'), '#/');
}

/* ---------- Sincronización (técnico) ---------- */
async function trySync(force = false) {
  if (!auth.user || !isTech() || !online) return;
  const res = await syncAll(auth.user.id, force);
  if (res?.status === 'stopped-session' || res?.status === 'no-session') auth = await getAuthState();
  if (force && res) {
    if (res.status === 'done') toast(res.confirmed ? `Sincronizado: ${res.confirmed} ticket(s) confirmado(s).` : 'Tickets al día.');
    else if (res.status === 'stopped-offline') toast('Sin conexión: tus cambios siguen guardados en el dispositivo.');
    else if (res.status === 'stopped-session' || res.status === 'no-session') toast('Inicia sesión para sincronizar.');
  }
  if (['', 'ticket'].includes(parseRoute().name) && !document.activeElement?.closest('form')) await render();
  void scheduleRetry();
}

/** Un único temporizador de un solo disparo hacia el próximo reintento (solo con la app visible). */
async function scheduleRetry() {
  clearTimeout(retryTimer);
  if (!auth.user || !isTech() || !auth.sessionValid || document.hidden) return;
  const next = (await listOps(auth.user.id)).map((o) => o.nextAttemptAt).filter((n) => n < Number.MAX_SAFE_INTEGER);
  if (next.length) retryTimer = window.setTimeout(() => void trySync(), Math.max(1000, Math.min(...next) - Date.now()));
}

async function refreshAuth() { auth = await getAuthState(); await render(); }

/* ---------- Clics ---------- */
document.addEventListener('click', async (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!el || !auth.user) return;
  const id = el.dataset.id ?? '';
  switch (el.dataset.action) {
    case 'sync': await trySync(true); break;
    case 'print': window.print(); break;
    case 'retry': await render(); break;
    case 'more': if (pager) { pager.page++; await loadPage(); } break;
    case 'keep-mine': await resolveKeepMine(id, auth.user.id); toast('Se reenviarán tus notas sobre la versión actual.'); await render(); void trySync(); break;
    case 'use-server': if (confirm('Se descartarán tus cambios locales de este ticket. ¿Continuar?')) { await resolveUseServer(id, auth.user.id); toast('Cambios locales descartados.'); location.hash = '#/'; await render(); } break;
    case 'clear-client': newState.client = null; newState.values = { ...newState.values, pppoe_username: '', full_name: '', address: '', address_reference: '', contact_phone: '' }; await render(); break;
    case 'pick-client': {
      const c = matchCache.get(id); const form = $<HTMLFormElement>('#new-ticket-form');
      if (c && form) { newState.values = readNew(form); newState.client = c; await render(); }
      break;
    }
    case 'logout': {
      const n = isTech() ? await syncCounts(auth.user.id) : { pending: 0, errors: 0 };
      if (n.pending + n.errors > 0 && !confirm(`Tienes ${n.pending + n.errors} ticket(s) sin confirmar. Seguirán guardados en este dispositivo y se enviarán cuando vuelvas a iniciar sesión con esta cuenta. ¿Cerrar sesión?`)) return;
      await signOut(); auth = { user: null, sessionValid: false }; loginNotice = ''; resetNew(); location.hash = '#/login'; await render(); break;
    }
  }
});

/* ---------- Formularios ---------- */
document.addEventListener('submit', async (e) => {
  const form = e.target as HTMLFormElement;
  e.preventDefault();
  const v = formValues(form);
  const intent = (e.submitter as HTMLElement | null)?.dataset.intent;
  try {
    if (form.id === 'login-form') {
      busy(form, true);
      try {
        auth = { user: await signIn(v.email, v.password), sessionValid: true };
        loginNotice = ''; location.hash = '#/'; await render(); void trySync();
      } catch (err) { app.innerHTML = loginView('', (err as Error).message, isSupabaseConfigured); }
    } else if (!auth.user) { return; }
    else if (form.id === 'attention-form') await submitAttention(form, intent);
    else if (form.id === 'client-search') {
      const results = $('#results')!;
      if (!online) { results.innerHTML = needsConnection(); return; }
      results.innerHTML = '<p class="muted">Buscando…</p>';
      const { clients, tickets } = await office.searchHistory(v.q ?? '');
      results.innerHTML = searchResults(clients, tickets);
    } else if (form.id === 'new-ticket-form') await submitNewTicket(form);
    else if (form.id === 'assign-form') {
      busy(form, true);
      if (form.dataset.status === 'in_progress' && !(v.reason ?? '').trim()) { toast('Escribe el motivo de la reasignación.'); busy(form, false); return; }
      await office.assignTicket(form.dataset.id!, v.technician_id, Number(form.dataset.version), (v.reason ?? '').trim() || null);
      toast('Asignación guardada.'); await render();
    } else if (form.id === 'office-edit-form') {
      busy(form, true);
      await office.updateTicketOffice(form.dataset.id!, Number(form.dataset.version), v.service_type, v.reported_problem, v.external_ticket_ref?.trim() || null);
      toast('Datos actualizados.'); await render();
    } else if (form.id === 'cancel-form' || form.id === 'reopen-form') {
      busy(form, true);
      const fn = form.id === 'cancel-form' ? office.cancelTicket : office.reopenTicket;
      await fn(form.dataset.id!, Number(form.dataset.version), v.reason);
      toast(form.id === 'cancel-form' ? 'Ticket cancelado.' : 'Ticket reabierto.'); await render();
    } else if (form.id === 'client-edit-form') {
      busy(form, true);
      if (!v.pppoe_username?.trim() || !v.address?.trim()) { toast('PPPoE y dirección son obligatorios.'); busy(form, false); return; }
      await office.updateClientRow(form.dataset.id!, Number(form.dataset.version), v as unknown as office.ClientFields);
      toast('Cliente actualizado.'); await render();
    } else if (form.id === 'user-create-form') {
      busy(form, true);
      await office.adminAction({ action: 'create', email: v.email, password: v.password, full_name: v.full_name, role: v.role });
      toast('Usuario creado.'); await render();
    } else if (form.classList.contains('user-form')) {
      busy(form, true);
      await office.adminAction({ action: 'update', user_id: form.dataset.id, role: v.role, active: v.active === '1' });
      toast('Usuario actualizado.'); await render();
    }
  } catch (err) {
    toast(err instanceof Error ? friendlyError(err) : 'Ocurrió un error.');
    busy(form, false);
  }
});

async function submitAttention(form: HTMLFormElement, intent: string | undefined) {
  const f = new FormData(form), s = (k: string) => String(f.get(k) ?? '');
  const input: AttentionInput = {
    status: intent === 'complete' ? 'completed' : 'in_progress',
    pppoe_confirmed: f.get('pppoe_confirmed') === 'on', address_confirmed: f.get('address_confirmed') === 'on',
    discrepancy_notes: s('discrepancy_notes'), diagnosis: s('diagnosis'), action_taken: s('action_taken'), result: s('result'), observations: s('observations'),
  };
  const id = form.dataset.id!;
  try {
    await saveAttentionLocal(id, auth.user!.id, input);
    toast('Atención guardada en este dispositivo; pendiente de sincronización.');
    if (input.status === 'completed') location.hash = '#/';
    await render(); void trySync();
  } catch (err) {
    if (!(err instanceof ValidationFailed)) throw err;
    const t = await getTicket(id, auth.user!.id);
    if (t) {
      app.innerHTML = techDetail(ctx(parseRoute()), t, err.errors, { pppoe_confirmed: input.pppoe_confirmed, address_confirmed: input.address_confirmed, discrepancy_notes: input.discrepancy_notes, diagnosis: input.diagnosis, action_taken: input.action_taken, result: input.result, observations: input.observations });
      app.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }
}

async function submitNewTicket(form: HTMLFormElement) {
  const values = readNew(form);
  newState.values = values;
  const errors = validateNewTicket(values);
  if (Object.keys(errors).length) {
    app.innerHTML = newTicketView(ctx(parseRoute()), techCache, values, errors, newState.client);
    app.querySelector<HTMLElement>('[aria-invalid="true"], .err')?.scrollIntoView({ block: 'center' });
    return;
  }
  busy(form, true);
  try {
    if (!newState.client) newState.client = await office.createClientRow(values); // si el ticket falla, el cliente ya existe y no se duplica al reintentar
    await office.createTicketRemote({
      id: newState.id, client_id: newState.client.id, service_type: values.service_type, reported_problem: values.reported_problem.trim(),
      technician_id: values.technician_id || null, external_ticket_ref: values.external_ticket_ref.trim() || null,
    });
  } catch (err) {
    toast(friendlyError(err));
    app.innerHTML = newTicketView(ctx(parseRoute()), techCache, values, {}, newState.client);
    return;
  }
  const id = newState.id;
  resetNew();
  toast('Ticket creado. El folio fue asignado por el servidor.');
  location.hash = `#/view/${id}`;
}

/* ---------- Búsquedas con espera ---------- */
document.addEventListener('input', (e) => {
  const t = e.target as HTMLElement;
  if (t.id === 'client-q') {
    clearTimeout(debounce);
    debounce = window.setTimeout(async () => {
      const box = $('#client-matches'); if (!box) return;
      try {
        const found = await office.searchClients((t as HTMLInputElement).value);
        found.forEach((c) => matchCache.set(c.id, c));
        box.innerHTML = found.map((c) => `<button type="button" class="item glass linkbtn" data-action="pick-client" data-id="${c.id}"><span class="title">${esc(c.full_name || c.pppoe_username)}</span><span class="small muted">${esc(c.pppoe_username)} · ${esc(c.address)}</span></button>`).join('');
      } catch (err) { box.innerHTML = `<p class="err">${esc(friendlyError(err))}</p>`; }
    }, 300);
  } else if (t.closest('#ticket-filters')) {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      const f = formValues($<HTMLFormElement>('#ticket-filters')!);
      void startPager('#list', (p) => office.listTicketsPage(f, p));
    }, 300);
  }
});
document.addEventListener('change', (e) => {
  if ((e.target as HTMLElement).closest('#ticket-filters')) {
    const f = formValues($<HTMLFormElement>('#ticket-filters')!);
    void startPager('#list', (p) => office.listTicketsPage(f, p));
  }
});
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

window.addEventListener('hashchange', () => void render());
window.addEventListener('online', async () => { online = true; await refreshAuth(); void trySync(); });
window.addEventListener('offline', () => { online = false; void render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void trySync(); else clearTimeout(retryTimer); });
engine?.onChange(() => { const n = parseRoute().name; if ((n === '' || n === 'ticket') && !document.activeElement?.closest('form')) void render(); });

/* ---------- Service Worker ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          toastEl.hidden = false;
          toastEl.innerHTML = 'Hay una versión nueva. <button class="btn small" id="reload-btn">Actualizar</button>';
          document.getElementById('reload-btn')?.addEventListener('click', () => { w.postMessage('SKIP_WAITING'); });
        }
      });
    });
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }).catch(() => { /* la app funciona igual, solo sin caché offline */ });
}

/* ---------- Arranque ---------- */
(async () => {
  await initDb();
  await getDb();
  registerSW();
  auth = await getAuthState();
  if (!auth.user) location.hash = '#/login';
  await render();
  void trySync();
})();
