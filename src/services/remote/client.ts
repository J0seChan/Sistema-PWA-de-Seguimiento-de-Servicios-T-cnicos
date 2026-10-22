import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && key && !url.includes('TU-PROYECTO'));

/** Solo URL y clave publicable (anon). La seguridad real la imponen las políticas RLS. */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'linkredes-auth' } })
  : null;
