-- =====================================================================
-- Link Redes Servicios · 001_schema.sql
-- Tablas, restricciones e índices. Ejecutar PRIMERO, manualmente, en el
-- editor SQL de Supabase (proyecto independiente de Monitor ISP).
-- Es idempotente: se puede volver a ejecutar sin perder datos.
-- No es destructivo: solo usa CREATE ... IF NOT EXISTS.
-- =====================================================================

-- 1. Perfiles (uno por usuario de Supabase Auth) -----------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null check (char_length(btrim(full_name)) between 1 and 120),
  role        text not null check (role in ('technician', 'supervisor', 'admin')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2. Contador anual de folios (solo lo usa la función next_folio) -------
create table if not exists public.folio_counters (
  year        integer primary key,
  last_value  integer not null default 0
);

-- 3. Servicios técnicos ------------------------------------------------
create table if not exists public.service_tickets (
  id                   uuid primary key,                       -- generado en el dispositivo
  folio                text not null unique,                   -- asignado por el servidor
  created_by           uuid not null references public.profiles (id),
  technician_id        uuid not null references public.profiles (id),
  external_ticket_ref  text check (external_ticket_ref is null or char_length(external_ticket_ref) <= 100),
  service_date         timestamptz not null,
  service_type         text not null check (service_type in
                         ('installation', 'support', 'failure', 'expansion', 'address_change', 'modem_change')),
  reported_problem     text not null check (char_length(btrim(reported_problem)) between 1 and 2000),
  diagnosis            text check (diagnosis is null or char_length(diagnosis) <= 2000),
  action_taken         text check (action_taken is null or char_length(action_taken) <= 2000),
  result               text check (result is null or char_length(result) <= 2000),
  service_status       text not null check (service_status in ('open', 'in_progress', 'completed')),
  observations         text check (observations is null or char_length(observations) <= 2000),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  version              integer not null default 1,
  -- Regla de negocio: un servicio completado exige diagnóstico, acción y resultado.
  constraint completed_requires_details check (
    service_status <> 'completed'
    or (nullif(btrim(diagnosis), '') is not null
        and nullif(btrim(action_taken), '') is not null
        and nullif(btrim(result), '') is not null)
  )
);

create index if not exists service_tickets_technician_idx on public.service_tickets (technician_id, service_date desc);
create index if not exists service_tickets_status_idx     on public.service_tickets (service_status);
