-- =====================================================================
-- Link Redes Servicios · 002_functions_and_triggers.sql
-- Folios, control de versión, protección de campos y funciones auxiliares.
-- Ejecutar DESPUÉS de 001_schema.sql. Idempotente (create or replace).
-- =====================================================================

-- Rol del usuario autenticado, solo si su perfil está activo (null si no).
create or replace function public.current_role_if_active()
returns text
language sql stable security definer
set search_path = public
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active
$$;
revoke all on function public.current_role_if_active() from public, anon;
grant execute on function public.current_role_if_active() to authenticated;

-- Siguiente folio: SRV-AAAA-NNNNNN (año en hora de Ciudad de México).
-- El contador se incrementa de forma atómica: no hay colisiones entre teléfonos.
create or replace function public.next_folio()
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  y integer := extract(year from (now() at time zone 'America/Mexico_City'))::integer;
  n integer;
begin
  insert into public.folio_counters (year, last_value) values (y, 1)
  on conflict (year) do update set last_value = public.folio_counters.last_value + 1
  returning last_value into n;
  return 'SRV-' || y::text || '-' || lpad(n::text, 6, '0');
end;
$$;
revoke all on function public.next_folio() from public, anon, authenticated;

-- INSERT: el servidor decide folio, versión y fechas (el cliente no puede elegirlos).
create or replace function public.service_tickets_before_insert()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  new.folio      := public.next_folio();
  new.version    := 1;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.service_tickets_before_insert() from public, anon, authenticated;

drop trigger if exists trg_service_tickets_before_insert on public.service_tickets;
create trigger trg_service_tickets_before_insert
  before insert on public.service_tickets
  for each row execute function public.service_tickets_before_insert();

-- UPDATE: campos de identidad inmutables, versión +1 y updated_at automáticos.
create or replace function public.service_tickets_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id            is distinct from old.id
  or new.folio         is distinct from old.folio
  or new.created_by    is distinct from old.created_by
  or new.created_at    is distinct from old.created_at then
    raise exception 'Campos de identidad inmutables' using errcode = '42501';
  end if;
  -- Solo administradores pueden reasignar el técnico responsable.
  if new.technician_id is distinct from old.technician_id
     and coalesce(public.current_role_if_active(), '') <> 'admin' then
    raise exception 'No puedes reasignar el técnico' using errcode = '42501';
  end if;
  new.version    := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_service_tickets_before_update on public.service_tickets;
create trigger trg_service_tickets_before_update
  before update on public.service_tickets
  for each row execute function public.service_tickets_before_update();

-- PERFILES: nadie (salvo un admin, o el editor SQL sin sesión) cambia roles ni activa/desactiva.
create or replace function public.profiles_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if auth.uid() is null then
    return new; -- editor SQL / rol de servicio: procedimiento administrativo autorizado
  end if;
  if new.id is distinct from old.id then
    raise exception 'El id del perfil no se puede cambiar' using errcode = '42501';
  end if;
  if (new.role is distinct from old.role or new.active is distinct from old.active)
     and coalesce(public.current_role_if_active(), '') <> 'admin' then
    raise exception 'No puedes cambiar rol ni estado' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_before_update on public.profiles;
create trigger trg_profiles_before_update
  before update on public.profiles
  for each row execute function public.profiles_before_update();
