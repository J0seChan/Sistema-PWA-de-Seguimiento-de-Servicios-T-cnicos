import type { AppUser } from '../../domain/types';
import { supabase } from '../remote/client';

const PROFILE_KEY = 'lr_profile'; // identidad conocida (solo para abrir datos locales sin conexión)

const cached = (): AppUser | null => {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null'); } catch { return null; }
};

async function fetchProfile(userId: string): Promise<AppUser> {
  const { data, error } = await supabase!.from('profiles').select('id, full_name, role, active').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Tu cuenta no tiene perfil. Pide a un administrador que lo cree.');
  const user: AppUser = { id: data.id, fullName: data.full_name, role: data.role, active: data.active };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(user));
  return user;
}

export async function signIn(email: string, password: string): Promise<AppUser> {
  if (!supabase) throw new Error('Supabase no está configurado (revisa el archivo .env).');
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error || !data.user) throw new Error(error?.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error?.message ?? 'No se pudo iniciar sesión.');
  const user = await fetchProfile(data.user.id);
  if (!user.active) { await supabase.auth.signOut(); localStorage.removeItem(PROFILE_KEY); throw new Error('Tu cuenta está desactivada.'); }
  return user;
}

export async function signOut(): Promise<void> {
  localStorage.removeItem(PROFILE_KEY); // los registros locales se conservan, ligados a su ownerId
  try { await supabase?.auth.signOut(); } catch { /* sin conexión: la sesión local se limpia igual */ }
}

export interface AuthState { user: AppUser | null; sessionValid: boolean }

/** Sesión válida → usuario real. Sin sesión pero con identidad conocida → modo limitado (solo datos locales). */
export async function getAuthState(): Promise<AuthState> {
  if (!supabase) return { user: null, sessionValid: false };
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      let user = cached();
      if (!user || user.id !== data.session.user.id) user = await fetchProfile(data.session.user.id);
      else if (navigator.onLine) user = await fetchProfile(user.id).catch(() => user!);
      if (!user.active) { await signOut(); return { user: null, sessionValid: false }; }
      return { user, sessionValid: true };
    }
  } catch { /* se cae a la identidad conocida */ }
  return { user: cached(), sessionValid: false };
}

export async function getSessionUserId(): Promise<string | null> {
  if (!supabase) return null;
  try { return (await supabase.auth.getSession()).data.session?.user.id ?? null; } catch { return null; }
}
