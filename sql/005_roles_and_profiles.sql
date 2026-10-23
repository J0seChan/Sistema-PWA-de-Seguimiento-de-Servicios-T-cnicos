-- =====================================================================
-- Link Redes Servicios · 005_roles_and_profiles.sql  (FASE 2)
-- Roles technician | dispatcher | admin, funciones auxiliares y creación
-- AUTOMÁTICA de perfiles. Ejecutar DESPUÉS de 001-003.
-- Se puede ejecutar más de una vez.
-- ⚠ Modifica datos: los perfiles con rol 'supervisor' pasan a 'dispatcher'
--   (decisión del propietario: supervisor se unifica con oficina).
-- =====================================================================

-- 1. Roles ---------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = 'dispatcher' where role = 'supervisor';
alter table public.profiles
  add constraint profiles_role_check check (role in ('technician', 'dispatcher', 'admin'));

-- 2. Ayudantes de permisos (leen el perfil en el servidor; nunca confían en el cliente)
create or replace function public.is_office()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_role_if_active() in ('dispatcher', 'admin'), false) $$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_role_if_active() in ('technician', 'dispatcher', 'admin'), false) $$;

revoke all on function public.is_office(), public.is_staff() from public, anon;
grant execute on function public.is_office(), public.is_staff() to authenticated;

-- 3. Perfil automático al crear un usuario en Supabase Auth ------------------
-- Antes NO existía ningún mecanismo: los perfiles se creaban a mano.
-- El perfil nace como technician INACTIVO: no recibe privilegios hasta que un admin
-- lo active/asigne rol (desde el panel de admin o con SQL). Así un usuario creado
-- por error en el Dashboard nunca queda operativo por sí solo.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, active)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
                  nullif(split_part(new.email, '@', 1), ''), 'Sin nombre'), 120),
    'technician', false)
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Relleno único para usuarios existentes sin perfil (quedan inactivos).
insert into public.profiles (id, full_name, role, active)
select u.id,
       left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), nullif(split_part(u.email, '@', 1), ''), 'Sin nombre'), 120),
       'technician', false
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- Verificación:
--   select id, full_name, role, active from public.profiles order by created_at;
