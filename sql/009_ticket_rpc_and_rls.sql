-- =====================================================================
-- Link Redes Servicios · 009_ticket_rpc_and_rls.sql  (FASE 2)
-- Permisos por rol, RLS y funciones de escritura. Ejecutar DESPUÉS de 008.
-- Se puede ejecutar más de una vez.
--
-- Modelo de seguridad:
--  * Nadie (anon/authenticated) tiene INSERT/UPDATE/DELETE directo sobre service_tickets.
--    Toda escritura pasa por funciones que validan rol, asignación y versión EN EL SERVIDOR.
--  * Las funciones son SECURITY DEFINER (necesario: escriben en tablas sin permiso directo
--    y en la bitácora) con search_path fijo, y revocadas a PUBLIC/anon.
--  * Un trigger rechaza escrituras directas a tickets de usuarios con sesión si no vienen
--    de esas funciones (defensa en profundidad).
--  * Lectura: oficina ve todo; el técnico ve sus tickets y los COMPLETADOS (historial global).
-- =====================================================================

-- 1. Triggers de tickets (reemplazan los de 002) ------------------------------------
create or replace function public.service_tickets_before_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is not null and coalesce(current_setting('lr.rpc', true), '') <> '1' then
    raise exception 'Usa las funciones autorizadas para crear tickets' using errcode = '42501';
  end if;
  new.folio := public.next_folio();   -- el cliente nunca elige el folio
  new.version := 1; new.created_at := now(); new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.service_tickets_before_insert() from public, anon, authenticated;

create or replace function public.service_tickets_before_update()
returns trigger language plpgsql set search_path = public
as $$
begin
  if auth.uid() is not null and coalesce(current_setting('lr.rpc', true), '') <> '1' then
    raise exception 'Usa las funciones autorizadas para modificar tickets' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.folio is distinct from old.folio
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
     or new.client_id is distinct from old.client_id
     or new.client_pppoe_snapshot is distinct from old.client_pppoe_snapshot
     or new.client_name_snapshot is distinct from old.client_name_snapshot
     or new.client_address_snapshot is distinct from old.client_address_snapshot
     or new.client_reference_snapshot is distinct from old.client_reference_snapshot then
    raise exception 'Campos de identidad inmutables' using errcode = '42501';
  end if;
  new.version := old.version + 1; new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_service_tickets_before_insert on public.service_tickets;
create trigger trg_service_tickets_before_insert before insert on public.service_tickets
  for each row execute function public.service_tickets_before_insert();
drop trigger if exists trg_service_tickets_before_update on public.service_tickets;
create trigger trg_service_tickets_before_update before update on public.service_tickets
  for each row execute function public.service_tickets_before_update();

-- 2. Permisos de tabla y RLS ---------------------------------------------------------
alter table public.clients         enable row level security;
alter table public.service_tickets enable row level security;
alter table public.profiles        enable row level security;

revoke all on public.service_tickets, public.clients from anon, authenticated;
grant select                 on public.service_tickets to authenticated;   -- escritura: solo funciones
grant select, insert, update on public.clients         to authenticated;   -- RLS limita la escritura a oficina
-- profiles: el rol y el estado activo NO se pueden cambiar desde la API (solo Edge Function de admin / SQL).
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

-- service_tickets
drop policy if exists tickets_select_own        on public.service_tickets;
drop policy if exists tickets_select_privileged on public.service_tickets;
drop policy if exists tickets_insert_own        on public.service_tickets;
drop policy if exists tickets_update_own        on public.service_tickets;
drop policy if exists tickets_select_office     on public.service_tickets;
drop policy if exists tickets_select_technician on public.service_tickets;

create policy tickets_select_office on public.service_tickets
  for select to authenticated using (public.is_office());

-- Técnico: sus tickets asignados (cualquier estado) + historial global de tickets COMPLETADOS.
create policy tickets_select_technician on public.service_tickets
  for select to authenticated
  using (public.current_role_if_active() = 'technician'
         and (technician_id = auth.uid() or service_status = 'completed'));

-- clients
drop policy if exists clients_select on public.clients;
drop policy if exists clients_insert on public.clients;
drop policy if exists clients_update on public.clients;
create policy clients_select on public.clients for select to authenticated using (public.is_staff());
create policy clients_insert on public.clients for insert to authenticated with check (public.is_office());
create policy clients_update on public.clients for update to authenticated
  using (public.is_office()) with check (public.is_office());

-- profiles
drop policy if exists profiles_admin_update   on public.profiles;
drop policy if exists profiles_select_office  on public.profiles;
create policy profiles_select_office on public.profiles   -- oficina necesita ver técnicos para asignar
  for select to authenticated using (public.is_office() and role = 'technician');
-- (profiles_select_own y profiles_select_admin de 003 siguen vigentes; profiles_update_own solo cambia full_name)

-- 3. Funciones de escritura ------------------------------------------------------------

-- 3.1 Crear ticket (oficina). Idempotente por p_id: reintentar no duplica.
create or replace function public.create_ticket(
  p_id uuid, p_client_id uuid, p_service_type text, p_reported_problem text,
  p_technician_id uuid default null, p_external_ticket_ref text default null)
returns public.service_tickets
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.service_tickets; v_client public.clients;
  v_tech public.profiles; v_row public.service_tickets;
begin
  perform set_config('lr.rpc', '1', true);
  if not public.is_office() then raise exception 'forbidden' using errcode = '42501'; end if;

  select * into v_existing from public.service_tickets where id = p_id;
  if found then
    if v_existing.created_by = v_uid then return v_existing; end if;
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_client from public.clients where id = p_client_id;
  if not found then raise exception 'client_not_found' using errcode = 'P0001'; end if;
  if p_technician_id is not null then
    select * into v_tech from public.profiles where id = p_technician_id and role = 'technician' and active;
    if not found then raise exception 'technician_invalid' using errcode = 'P0001'; end if;
  end if;

  insert into public.service_tickets (
    id, created_by, technician_id, technician_name, client_id, client_pppoe_snapshot, client_name_snapshot,
    client_address_snapshot, client_reference_snapshot, external_ticket_ref, service_date, service_type,
    reported_problem, service_status, assigned_at)
  values (
    p_id, v_uid, p_technician_id, v_tech.full_name, v_client.id, v_client.pppoe_username, v_client.full_name,
    v_client.address, v_client.address_reference, nullif(btrim(p_external_ticket_ref), ''), now(), p_service_type,
    btrim(p_reported_problem), case when p_technician_id is null then 'unassigned' else 'assigned' end,
    case when p_technician_id is null then null else now() end)
  returning * into v_row;

  insert into public.ticket_events (ticket_id, event_type, actor_id, details)
  values (v_row.id, 'created', v_uid, jsonb_build_object('client_id', v_client.id));
  if p_technician_id is not null then
    insert into public.ticket_events (ticket_id, event_type, actor_id, details)
    values (v_row.id, 'assigned', v_uid, jsonb_build_object('to', p_technician_id));
  end if;
  return v_row;
end;
$$;

-- 3.2 Asignar / reasignar (oficina). Reasignar un ticket EN PROCESO exige motivo y lo regresa a 'assigned'.
create or replace function public.assign_ticket(
  p_ticket_id uuid, p_technician_id uuid, p_expected_version integer, p_reason text default null)
returns public.service_tickets
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_t public.service_tickets; v_tech public.profiles; v_row public.service_tickets;
begin
  perform set_config('lr.rpc', '1', true);
  if not public.is_office() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_t from public.service_tickets where id = p_ticket_id for update;
  if not found then raise exception 'ticket_not_found' using errcode = 'P0001'; end if;
  if v_t.version <> p_expected_version then raise exception 'version_conflict' using errcode = 'P0001'; end if;
  if v_t.service_status in ('completed', 'cancelled') then raise exception 'ticket_closed' using errcode = 'P0001'; end if;
  select * into v_tech from public.profiles where id = p_technician_id and role = 'technician' and active;
  if not found then raise exception 'technician_invalid' using errcode = 'P0001'; end if;
  if v_t.technician_id is not distinct from p_technician_id then return v_t; end if;
  if v_t.service_status = 'in_progress' and nullif(btrim(p_reason), '') is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  update public.service_tickets
     set technician_id = p_technician_id, technician_name = v_tech.full_name, assigned_at = now(),
         started_at = null, service_status = 'assigned'
   where id = p_ticket_id returning * into v_row;
  insert into public.ticket_events (ticket_id, event_type, actor_id, details)
  values (p_ticket_id, case when v_t.technician_id is null then 'assigned' else 'reassigned' end, v_uid,
          jsonb_build_object('from', v_t.technician_id, 'to', p_technician_id,
                             'previous_status', v_t.service_status, 'reason', nullif(btrim(p_reason), '')));
  return v_row;
end;
$$;

-- 3.3 Editar datos de oficina (tipo, problema reportado, referencia externa).
create or replace function public.update_ticket_office(
  p_ticket_id uuid, p_expected_version integer, p_service_type text,
  p_reported_problem text, p_external_ticket_ref text default null)
returns public.service_tickets
language plpgsql security definer set search_path = public
as $$
declare v_t public.service_tickets; v_row public.service_tickets;
begin
  perform set_config('lr.rpc', '1', true);
  if not public.is_office() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_t from public.service_tickets where id = p_ticket_id for update;
  if not found then raise exception 'ticket_not_found' using errcode = 'P0001'; end if;
  if v_t.version <> p_expected_version then raise exception 'version_conflict' using errcode = 'P0001'; end if;
  if v_t.service_status in ('completed', 'cancelled') then raise exception 'ticket_closed' using errcode = 'P0001'; end if;
  update public.service_tickets
     set service_type = p_service_type, reported_problem = btrim(p_reported_problem),
         external_ticket_ref = nullif(btrim(p_external_ticket_ref), '')
   where id = p_ticket_id returning * into v_row;
  insert into public.ticket_events (ticket_id, event_type, actor_id, details)
  values (p_ticket_id, 'edited', auth.uid(), jsonb_build_object(
    'service_type_changed', v_t.service_type is distinct from v_row.service_type,
    'problem_changed', v_t.reported_problem is distinct from v_row.reported_problem));
  return v_row;
end;
$$;

-- 3.4 Cancelar (no existe borrado físico). Motivo obligatorio.
create or replace function public.cancel_ticket(p_ticket_id uuid, p_expected_version integer, p_reason text)
returns public.service_tickets
language plpgsql security definer set search_path = public
as $$
declare v_t public.service_tickets; v_row public.service_tickets;
begin
  perform set_config('lr.rpc', '1', true);
  if not public.is_office() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_t from public.service_tickets where id = p_ticket_id for update;
  if not found then raise exception 'ticket_not_found' using errcode = 'P0001'; end if;
  if v_t.version <> p_expected_version then raise exception 'version_conflict' using errcode = 'P0001'; end if;
  if v_t.service_status in ('completed', 'cancelled') then raise exception 'ticket_closed' using errcode = 'P0001'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required' using errcode = 'P0001'; end if;
  update public.service_tickets set service_status = 'cancelled' where id = p_ticket_id returning * into v_row;
  insert into public.ticket_events (ticket_id, event_type, actor_id, details)
  values (p_ticket_id, 'cancelled', auth.uid(), jsonb_build_object('reason', btrim(p_reason), 'previous_status', v_t.service_status));
  return v_row;
end;
$$;

-- 3.5 Reabrir un ticket completado o cancelado (oficina, con motivo).
create or replace function public.reopen_ticket(p_ticket_id uuid, p_expected_version integer, p_reason text)
returns public.service_tickets
language plpgsql security definer set search_path = public
as $$
declare v_t public.service_tickets; v_row public.service_tickets;
begin
  perform set_config('lr.rpc', '1', true);
  if not public.is_office() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_t from public.service_tickets where id = p_ticket_id for update;
  if not found then raise exception 'ticket_not_found' using errcode = 'P0001'; end if;
  if v_t.version <> p_expected_version then raise exception 'version_conflict' using errcode = 'P0001'; end if;
  if v_t.service_status not in ('completed', 'cancelled') then raise exception 'ticket_not_closed' using errcode = 'P0001'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required' using errcode = 'P0001'; end if;
  update public.service_tickets
     set service_status = case when technician_id is null then 'unassigned' else 'assigned' end,
         completed_at = null, started_at = null
   where id = p_ticket_id returning * into v_row;
  insert into public.ticket_events (ticket_id, event_type, actor_id, details)
  values (p_ticket_id, 'reopened', auth.uid(), jsonb_build_object('reason', btrim(p_reason), 'previous_status', v_t.service_status));
  return v_row;
end;
$$;

-- 3.6 Registrar la atención (técnico asignado). Solo toca campos de atención.
-- Idempotente por p_operation_id; control de versión optimista.
create or replace function public.save_ticket_attention(
  p_ticket_id uuid, p_expected_version integer, p_operation_id uuid, p_status text,
  p_pppoe_confirmed boolean, p_address_confirmed boolean, p_discrepancy_notes text,
  p_diagnosis text, p_action_taken text, p_result text, p_observations text)
returns public.service_tickets
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid(); v_t public.service_tickets; v_row public.service_tickets;
  v_notes text := nullif(btrim(p_discrepancy_notes), '');
begin
  perform set_config('lr.rpc', '1', true);
  if public.current_role_if_active() is distinct from 'technician' then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_t from public.service_tickets where id = p_ticket_id for update;
  -- No revela si el ticket existe: solo el técnico asignado puede registrar atención.
  if not found or v_t.technician_id is distinct from v_uid then raise exception 'not_assigned' using errcode = '42501'; end if;
  if p_operation_id is not null and v_t.last_operation_id = p_operation_id then return v_t; end if; -- ya aplicada
  if v_t.version <> p_expected_version then raise exception 'version_conflict' using errcode = 'P0001'; end if;
  if v_t.service_status not in ('assigned', 'in_progress') then raise exception 'ticket_closed' using errcode = 'P0001'; end if;
  if p_status not in ('in_progress', 'completed') then raise exception 'invalid_status' using errcode = 'P0001'; end if;
  if p_status = 'completed' and (
       nullif(btrim(p_diagnosis), '') is null or nullif(btrim(p_action_taken), '') is null
       or nullif(btrim(p_result), '') is null
       or not (coalesce(p_pppoe_confirmed, false) and coalesce(p_address_confirmed, false) or v_notes is not null)) then
    raise exception 'completion_requirements' using errcode = 'P0001';
  end if;

  update public.service_tickets
     set pppoe_confirmed = coalesce(p_pppoe_confirmed, false), address_confirmed = coalesce(p_address_confirmed, false),
         discrepancy_notes = v_notes, diagnosis = nullif(btrim(p_diagnosis), ''),
         action_taken = nullif(btrim(p_action_taken), ''), result = nullif(btrim(p_result), ''),
         observations = nullif(btrim(p_observations), ''), service_status = p_status,
         started_at = coalesce(started_at, now()),
         completed_at = case when p_status = 'completed' then now() else null end,
         last_operation_id = p_operation_id
   where id = p_ticket_id returning * into v_row;

  if v_t.service_status = 'assigned' then
    insert into public.ticket_events (ticket_id, event_type, actor_id) values (p_ticket_id, 'started', v_uid);
  end if;
  if v_notes is not null and v_notes is distinct from v_t.discrepancy_notes then
    insert into public.ticket_events (ticket_id, event_type, actor_id) values (p_ticket_id, 'discrepancy_reported', v_uid);
  end if;
  if p_status = 'completed' then
    insert into public.ticket_events (ticket_id, event_type, actor_id) values (p_ticket_id, 'completed', v_uid);
  elsif v_t.service_status <> 'assigned' then
    insert into public.ticket_events (ticket_id, event_type, actor_id) values (p_ticket_id, 'attention_saved', v_uid);
  end if;
  return v_row;
end;
$$;

-- 4. Permisos de ejecución: nada para PUBLIC/anon; solo sesiones autenticadas.
revoke all on function public.create_ticket(uuid, uuid, text, text, uuid, text) from public, anon;
revoke all on function public.assign_ticket(uuid, uuid, integer, text) from public, anon;
revoke all on function public.update_ticket_office(uuid, integer, text, text, text) from public, anon;
revoke all on function public.cancel_ticket(uuid, integer, text) from public, anon;
revoke all on function public.reopen_ticket(uuid, integer, text) from public, anon;
revoke all on function public.save_ticket_attention(uuid, integer, uuid, text, boolean, boolean, text, text, text, text, text) from public, anon;
grant execute on function public.create_ticket(uuid, uuid, text, text, uuid, text) to authenticated;
grant execute on function public.assign_ticket(uuid, uuid, integer, text) to authenticated;
grant execute on function public.update_ticket_office(uuid, integer, text, text, text) to authenticated;
grant execute on function public.cancel_ticket(uuid, integer, text) to authenticated;
grant execute on function public.reopen_ticket(uuid, integer, text) to authenticated;
grant execute on function public.save_ticket_attention(uuid, integer, uuid, text, boolean, boolean, text, text, text, text, text) to authenticated;
