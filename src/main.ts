import './styles/main.css';
import { getAuthState, signIn, signOut, type AuthState } from './services/auth/auth';
import { isSupabaseConfigured } from './services/remote/client';
import { getDb, initDb } from './services/local/db';
import { createLocalTicket, getTicket, listOps, listTickets, resolveKeepMine, resolveUseServer, syncCounts, updateLocalTicket, ValidationFailed } from './services/local/tickets';
import { engine, syncAll } from './services/sync';
import { validateTicketInput, type FieldErrors } from './domain/validation';
import { isServiceStatus, isServiceType } from './domain/catalogs';
import type { TicketInput } from './domain/types';
import { detailView, formView, historyView, homeView, listItems, loginView, printView, shell, type Ctx } from './app/views';

const app = document.getElementById('app')!;
const toastEl = document.getElementById('toast')!;
let auth: AuthState = { user: null, sessionValid: false };
let online = navigator.onLine;
let loginNotice = '';
let toastTimer: number | undefined;
let retryTimer: number | undefined;

const ctx = (): Ctx => ({ user: auth.user, sessionValid: auth.sessionValid, online, syncing: engine?.isRunning ?? false });
const owner = () => ({ id: auth.user!.id, name: auth.user!.fullName });

function toast(msg: string) {
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => (toastEl.hidden = true), 4500);
}

const blankInput = (): TicketInput => ({
  service_date: new Date().toISOString(), service_type: 'support', service_status: 'open',
  reported_problem: '', diagnosis: null, action_taken: null, result: null, observations: null, external_ticket_ref: null,
});

function readForm(form: HTMLFormElement): TicketInput {
  const f = new FormData(form);
  const s = (k: string) => String(f.get(k) ?? '');
  const date = new Date(s('service_date'));
  const type = s('service_type'), status = s('service_status');
  return {
    service_date: Number.isNaN(date.getTime()) ? 'invalid' : date.toISOString(),
    service_type: isServiceType(type) ? type : ('' as never),
    service_status: isServiceStatus(status) ? status : ('' as never),
    reported_problem: s('reported_problem'), diagnosis: s('diagnosis'), action_taken: s('action_taken'),
    result: s('result'), observations: s('observations'), external_ticket_ref: s('external_ticket_ref'),
  };
}

/* ---------- Enrutado ---------- */
async function render() {
  const [route, id] = (location.hash.replace(/^#\/?/, '') || '').split('/');
  if (!auth.user || route === 'login') {
    if (auth.user && auth.sessionValid) { location.hash = '#/'; return; }
    const notice = loginNotice || (auth.user ? 'Tu sesión expiró. Inicia sesión para seguir sincronizando.' : '');
    app.innerHTML = loginView(notice, '', isSupabaseConfigured);
    return;
  }
  const c = ctx();
  const uid = auth.user.id;
  switch (route) {
    case 'new':
      app.innerHTML = formView(c, blankInput(), {}, false); break;
    case 'edit': {
      const t = await getTicket(id, uid);
      if (!t) return void (location.hash = '#/history');
      app.innerHTML = formView(c, t, {}, true); break;
    }
    case 'history': {
      app.innerHTML = historyView(c);
      await renderList(); break;
    }
    case 'ticket': {
      const t = await getTicket(id, uid);
      app.innerHTML = t ? detailView(c, t) : shell(c, '<div class="card glass empty"><h3>Servicio no encontrado</h3></div>', '#/history'); break;
    }
    case 'print': {
      const t = await getTicket(id, uid);
      app.innerHTML = t ? printView(t) : shell(c, '<div class="card glass empty"><h3>Servicio no encontrado</h3></div>', '#/history'); break;
    }
    default:
      app.innerHTML = homeView(c, await syncCounts(uid));
  }
}

async function renderList() {
  const list = document.getElementById('list');
  const form = document.getElementById('filters') as HTMLFormElement | null;
  if (!list || !form || !auth.user) return;
  const f = new FormData(form);
  const q = String(f.get('q') ?? '').trim().toLowerCase();
  const from = String(f.get('from') ?? ''), to = String(f.get('to') ?? '');
  const type = String(f.get('type') ?? ''), status = String(f.get('status') ?? ''), sync = String(f.get('sync') ?? '');
  const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity;
  const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : Infinity;
  const all = await listTickets(auth.user.id);
  list.innerHTML = listItems(all.filter((t) => {
    const d = Date.parse(t.service_date);
    if (q && !(t.folio ?? '').toLowerCase().includes(q)) return false;
    if (d < fromMs || d > toMs) return false;
    if (type && t.service_type !== type) return false;
    if (status && t.service_status !== status) return false;
    if (sync === 'pending' && !(t.syncStatus === 'pending' || t.syncStatus === 'syncing')) return false;
    if (sync && sync !== 'pending' && t.syncStatus !== sync) return false;
    return true;
  }));
}

/* ---------- Sincronización ---------- */
async function trySync(force = false) {
  if (!auth.user || !online) return;
  const res = await syncAll(owner(), force);
  if (res?.status === 'stopped-session' || res?.status === 'no-session') {
    auth = await getAuthState();
  }
  if (force && res) {
    if (res.status === 'done') toast(res.confirmed ? `Sincronizado: ${res.confirmed} servicio(s) confirmado(s).` : 'No hay nada pendiente por enviar.');
    else if (res.status === 'stopped-offline') toast('Sin conexión: los servicios siguen guardados en el dispositivo.');
    else if (res.status === 'stopped-session' || res.status === 'no-session') toast('Inicia sesión para sincronizar.');
  }
  await render();
  scheduleRetry();
}

/** Un único temporizador de un solo disparo hacia el próximo reintento (solo con la app visible). */
async function scheduleRetry() {
  clearTimeout(retryTimer);
  if (!auth.user || !auth.sessionValid || document.hidden) return;
  const next = (await listOps(auth.user.id)).map((o) => o.nextAttemptAt).filter((n) => n < Number.MAX_SAFE_INTEGER);
  if (!next.length) return;
  retryTimer = window.setTimeout(() => void trySync(), Math.max(1000, Math.min(...next) - Date.now()));
}

async function refreshAuth() {
  auth = await getAuthState();
  await render();
}

/* ---------- Eventos ---------- */
document.addEventListener('click', async (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!el || !auth.user) return;
  const id = el.dataset.id ?? '';
  switch (el.dataset.action) {
    case 'sync': await trySync(true); break;
    case 'print': window.print(); break;
    case 'keep-mine': await resolveKeepMine(id, auth.user.id); toast('Se reenviarán tus cambios.'); await render(); void trySync(); break;
    case 'use-server': await resolveUseServer(id, auth.user.id); toast('Se conservó la versión del servidor.'); await render(); break;
    case 'logout': {
      const pending = (await syncCounts(auth.user.id));
      if (pending.pending + pending.errors > 0 && !confirm(`Tienes ${pending.pending + pending.errors} servicio(s) sin confirmar. Seguirán guardados en este dispositivo y se enviarán cuando vuelvas a iniciar sesión con esta cuenta. ¿Cerrar sesión?`)) return;
      await signOut(); auth = { user: null, sessionValid: false }; loginNotice = ''; location.hash = '#/login'; await render(); break;
    }
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target as HTMLFormElement;
  e.preventDefault();
  if (form.id === 'login-form') {
    const f = new FormData(form);
    const btn = form.querySelector('button')!; btn.disabled = true;
    try {
      auth = { user: await signIn(String(f.get('email')), String(f.get('password'))), sessionValid: true };
      loginNotice = ''; location.hash = '#/'; await render(); void trySync();
    } catch (err) {
      app.innerHTML = loginView('', (err as Error).message, isSupabaseConfigured);
    }
  } else if (form.id === 'ticket-form' && auth.user) {
    const input = readForm(form);
    const editId = location.hash.startsWith('#/edit/') ? location.hash.split('/')[2] : null;
    const errors: FieldErrors = validateTicketInput(input);
    if (Object.keys(errors).length) {
      app.innerHTML = formView(ctx(), { ...input, service_date: input.service_date === 'invalid' ? new Date().toISOString() : input.service_date, service_type: input.service_type || 'support', service_status: input.service_status || 'open' }, errors, !!editId);
      (app.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus();
      return;
    }
    try {
      const t = editId ? await updateLocalTicket(editId, auth.user.id, input) : await createLocalTicket(owner(), input);
      toast('Servicio guardado en este dispositivo; pendiente de sincronización.');
      location.hash = `#/ticket/${t.id}`;
      void trySync();
    } catch (err) {
      if (err instanceof ValidationFailed) app.innerHTML = formView(ctx(), input, err.errors, !!editId);
      else toast((err as Error).message);
    }
  }
});

document.addEventListener('input', (e) => { if ((e.target as HTMLElement).closest('#filters')) void renderList(); });
document.addEventListener('change', (e) => { if ((e.target as HTMLElement).closest('#filters')) void renderList(); });
window.addEventListener('hashchange', () => void render());
window.addEventListener('online', async () => { online = true; await refreshAuth(); void trySync(); });
window.addEventListener('offline', () => { online = false; void render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void trySync(); else clearTimeout(retryTimer); });
engine?.onChange(() => { if (['', '#', '#/'].includes(location.hash)) void render(); });

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
