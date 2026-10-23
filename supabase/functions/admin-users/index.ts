// Edge Function "admin-users" — gestión de usuarios y roles SOLO para administradores.
// Corre en Supabase (Deno). Usa la clave service_role que Supabase inyecta como secreto del
// entorno de la función (SUPABASE_SERVICE_ROLE_KEY): NUNCA llega al navegador.
//
// Acciones (POST JSON):
//   { action: 'create',         email, password, full_name, role }
//   { action: 'update',         user_id, role?, active?, full_name? }
//   { action: 'reset_password', user_id, password }
//
// Seguridad: verifica el JWT del que llama, lee SU perfil con service_role y exige rol admin activo.
// Un admin no puede quitarse a sí mismo el rol ni desactivarse.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*', // la autorización real es el JWT, no el origen
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const ROLES = ['technician', 'dispatcher', 'admin'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'No autenticado' }, 401);

  // 1. ¿Quién llama? (se valida el JWT contra Auth)
  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: who, error: whoErr } = await asCaller.auth.getUser(token);
  if (whoErr || !who.user) return json({ error: 'Sesión no válida' }, 401);

  // 2. ¿Es admin activo? (se consulta en el servidor; el rol del navegador no cuenta)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: me } = await admin.from('profiles').select('role, active').eq('id', who.user.id).maybeSingle();
  if (!me || me.role !== 'admin' || !me.active) return json({ error: 'Solo administradores' }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'JSON no válido' }, 400); }
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  try {
    if (body.action === 'create') {
      const email = str(body.email).toLowerCase(), password = String(body.password ?? ''), full_name = str(body.full_name), role = str(body.role);
      if (!EMAIL.test(email)) return json({ error: 'Correo no válido' }, 400);
      if (password.length < 10) return json({ error: 'La contraseña debe tener al menos 10 caracteres' }, 400);
      if (!full_name || full_name.length > 120) return json({ error: 'Nombre obligatorio (máx. 120)' }, 400);
      if (!ROLES.includes(role)) return json({ error: 'Rol no válido' }, 400);

      const { data: created, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name },
      });
      if (error || !created.user) return json({ error: error?.message ?? 'No se pudo crear el usuario' }, 400);
      // El trigger handle_new_user ya creó un perfil inactivo; aquí se fija rol y se activa.
      const { error: pErr } = await admin.from('profiles').upsert(
        { id: created.user.id, full_name, role, active: true }, { onConflict: 'id' });
      if (pErr) return json({ error: `Usuario creado pero el perfil falló: ${pErr.message}` }, 500);
      return json({ ok: true, user_id: created.user.id });
    }

    if (body.action === 'update') {
      const id = str(body.user_id);
      if (!id) return json({ error: 'user_id requerido' }, 400);
      const patch: Record<string, unknown> = {};
      if (body.role !== undefined) { if (!ROLES.includes(str(body.role))) return json({ error: 'Rol no válido' }, 400); patch.role = str(body.role); }
      if (body.active !== undefined) patch.active = body.active === true;
      if (body.full_name !== undefined) { const n = str(body.full_name); if (!n || n.length > 120) return json({ error: 'Nombre no válido' }, 400); patch.full_name = n; }
      if (!Object.keys(patch).length) return json({ error: 'Nada que actualizar' }, 400);
      if (id === who.user.id && (('role' in patch && patch.role !== 'admin') || patch.active === false)) {
        return json({ error: 'No puedes quitarte el rol de admin ni desactivarte a ti mismo' }, 400);
      }
      const { error } = await admin.from('profiles').update(patch).eq('id', id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (body.action === 'reset_password') {
      const id = str(body.user_id), password = String(body.password ?? '');
      if (!id || password.length < 10) return json({ error: 'user_id y contraseña (mín. 10 caracteres) requeridos' }, 400);
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Error interno' }, 500);
  }
});
