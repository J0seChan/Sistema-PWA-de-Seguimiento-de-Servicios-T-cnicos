-- =====================================================================
-- Link Redes Servicios · 006_clients_and_ticket_fields.sql  (FASE 2)
-- Tabla de clientes + nuevos campos/estados de service_tickets.
-- Ejecutar DESPUÉS de 005. Se puede ejecutar más de una vez.
-- ⚠ Cambia el estado 'open' de tickets existentes a 'assigned'/'unassigned'.
--   No borra datos. Los tickets anteriores (de prueba) conservan client_id nulo.
-- =====================================================================

-- 1. Clientes --------------------------------------------------------------
create table if not exists public.clients (
  id                uuid primary key default gen_random_uuid(),
  pppoe_username    text not null check (char_length(btrim(pppoe_username)) between 1 and 100),
  pppoe_key         text generated always as (lower(btrim(pppoe_username))) stored,
  full_name         text check (full_name is null or char_length(full_name) <= 150),
  address           text not null check (char_length(btrim(address)) between 1 and 300),
  address_reference text check (address_reference is null or char_length(address_reference) <= 300),
  contact_phone     text check (contact_phone is null or char_length(contact_phone) <= 30),
  created_by        uuid references public.profiles (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1
);
-- Un PPPoE (normalizado: sin espacios extremos y sin distinguir mayúsculas) identifica a un solo cliente.
-- El id del cliente es estable aunque el PPPoE cambie; los tickets guardan copia histórica.
create unique index if not exists clients_pppoe_key_uidx on public.clients (pppoe_key);
create index if not exists clients_pppoe_prefix_idx on public.clients (pppoe_key text_pattern_ops);

create or replace function public.clients_before_write()
returns trigger language plpgsql set search_path = public
as $$
begin
  new.pppoe_username    := btrim(new.pppoe_username);
  new.full_name         := nullif(btrim(new.full_name), '');
  new.address           := btrim(new.address);
  new.address_reference := nullif(btrim(new.address_reference), '');
  new.contact_phone     := nullif(btrim(new.contact_phone), '');
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.version := 1; new.created_at := now(); new.updated_at := now();
  else
    if new.id is distinct from old.id or new.created_at is distinct from old.created_at
       or new.created_by is distinct from old.created_by then
      raise exception 'Campos de identidad inmutables' using errcode = '42501';
    end if;
    new.version := old.version + 1; new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_clients_before_write on public.clients;
create trigger trg_clients_before_write before insert or update on public.clients
  for each row execute function public.clients_before_write();

-- 2. Campos nuevos en service_tickets ------------------------------------------
alter table public.service_tickets alter column technician_id drop not null; -- ticket sin asignar
alter table public.service_tickets
  add column if not exists technician_name           text,           -- copia del nombre al asignar (evita exponer perfiles)
  add column if not exists client_id                 uuid references public.clients (id) on delete restrict,
  add column if not exists client_pppoe_snapshot     text,           -- datos originales capturados por oficina (inmutables)
  add column if not exists client_name_snapshot      text,
  add column if not exists client_address_snapshot   text,
  add column if not exists client_reference_snapshot text,
  add column if not exists assigned_at               timestamptz,
  add column if not exists started_at                timestamptz,
  add column if not exists completed_at              timestamptz,
  add column if not exists pppoe_confirmed           boolean not null default false,
  add column if not exists address_confirmed         boolean not null default false,
  add column if not exists discrepancy_notes         text check (discrepancy_notes is null or char_length(discrepancy_notes) <= 2000),
  add column if not exists last_operation_id         uuid;           -- idempotencia de operaciones del técnico

-- 3. Estados: unassigned → assigned → in_progress → completed (+ cancelled) --------
alter table public.service_tickets drop constraint if exists service_tickets_service_status_check;
alter table public.service_tickets drop constraint if exists ticket_status_check;
update public.service_tickets
   set service_status = case when technician_id is null then 'unassigned' else 'assigned' end
 where service_status = 'open';
alter table public.service_tickets
  add constraint ticket_status_check
  check (service_status in ('unassigned', 'assigned', 'in_progress', 'completed', 'cancelled'));

alter table public.service_tickets drop constraint if exists ticket_assignment_consistency;
alter table public.service_tickets
  add constraint ticket_assignment_consistency
  check ((service_status = 'unassigned') = (technician_id is null) or service_status = 'cancelled');

-- Completado exige diagnóstico, acción, resultado y (confirmaciones o discrepancia registrada).
-- NOT VALID: no revalida filas antiguas (de prueba); aplica a toda escritura nueva.
alter table public.service_tickets drop constraint if exists completed_requires_details;
alter table public.service_tickets
  add constraint completed_requires_details check (
    service_status <> 'completed'
    or (nullif(btrim(diagnosis), '') is not null
        and nullif(btrim(action_taken), '') is not null
        and nullif(btrim(result), '') is not null
        and completed_at is not null
        and ((pppoe_confirmed and address_confirmed) or nullif(btrim(discrepancy_notes), '') is not null))
  ) not valid;

-- Todo ticket NUEVO debe pertenecer a un cliente (los de prueba anteriores quedan exentos).
alter table public.service_tickets drop constraint if exists ticket_requires_client;
alter table public.service_tickets
  add constraint ticket_requires_client check (
    client_id is not null and client_pppoe_snapshot is not null and client_address_snapshot is not null
  ) not valid;

create index if not exists service_tickets_client_idx   on public.service_tickets (client_id, created_at desc);
create index if not exists service_tickets_assigned_idx on public.service_tickets (technician_id, service_status);
create index if not exists service_tickets_status_idx2  on public.service_tickets (service_status, created_at desc);
create index if not exists service_tickets_created_idx  on public.service_tickets (created_at desc);

-- Verificación:
--   select service_status, count(*) from public.service_tickets group by 1;
