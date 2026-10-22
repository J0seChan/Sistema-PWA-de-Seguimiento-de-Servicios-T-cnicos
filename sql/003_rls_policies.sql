-- =====================================================================
-- Link Redes Servicios · 003_rls_policies.sql
-- RLS + permisos de tabla. Ejecutar DESPUÉS de 002. Idempotente.
-- RLS es la autoridad final: ocultar botones en la PWA NO es seguridad.
-- =====================================================================

alter table public.profiles        enable row level security;
alter table public.folio_counters  enable row level security;  -- sin políticas = nadie accede
alter table public.service_tickets enable row level security;

-- Permisos de tabla: anónimos sin acceso; autenticados solo lo necesario.
revoke all on public.profiles, public.folio_counters, public.service_tickets from anon, authenticated;
grant select                 on public.profiles        to authenticated;
grant update (full_name)     on public.profiles        to authenticated;  -- rol y active solo vía admin/SQL
grant select, insert, update on public.service_tickets to authenticated;  -- sin DELETE: no hay borrado físico

-- ---- profiles ----
drop policy if exists profiles_select_own    on public.profiles;
drop policy if exists profiles_select_admin  on public.profiles;
drop policy if exists profiles_update_own    on public.profiles;
drop policy if exists profiles_admin_update  on public.profiles;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());

create policy profiles_select_admin on public.profiles
  for select to authenticated using (public.current_role_if_active() = 'admin');

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid() and public.current_role_if_active() is not null)
  with check (id = auth.uid());

-- Un admin puede actualizar perfiles (el trigger igualmente protege el id).
-- Nota: el grant de columnas de arriba solo cubre full_name; para que un admin cambie
-- rol/active desde la API habría que ampliar el grant. En el MVP se hace desde el editor SQL.
create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (public.current_role_if_active() = 'admin')
  with check (public.current_role_if_active() = 'admin');

-- ---- service_tickets ----
drop policy if exists tickets_select_own        on public.service_tickets;
drop policy if exists tickets_select_privileged on public.service_tickets;
drop policy if exists tickets_insert_own        on public.service_tickets;
drop policy if exists tickets_update_own        on public.service_tickets;

-- Técnico: solo servicios donde es el responsable (y su perfil sigue activo).
create policy tickets_select_own on public.service_tickets
  for select to authenticated
  using (technician_id = auth.uid() and public.current_role_if_active() is not null);

-- Supervisor / admin: lectura explícita de todos (sin escritura en el MVP).
create policy tickets_select_privileged on public.service_tickets
  for select to authenticated
  using (public.current_role_if_active() in ('supervisor', 'admin'));

-- Insertar: created_by y technician_id deben ser la identidad autenticada.
create policy tickets_insert_own on public.service_tickets
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and technician_id = auth.uid()
    and public.current_role_if_active() in ('technician', 'admin')
  );

-- Actualizar: solo servicios propios; el trigger protege folio, creador y versión.
create policy tickets_update_own on public.service_tickets
  for update to authenticated
  using (technician_id = auth.uid() and public.current_role_if_active() in ('technician', 'admin'))
  with check (technician_id = auth.uid());
