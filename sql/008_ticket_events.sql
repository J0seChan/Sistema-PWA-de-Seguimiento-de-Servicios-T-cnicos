-- =====================================================================
-- Link Redes Servicios · 008_ticket_events.sql  (FASE 2)
-- Bitácora inmutable de eventos del ticket. Ejecutar DESPUÉS de 007.
-- Se escribe SOLO desde las funciones de 009 (nadie tiene INSERT directo).
-- Guarda quién hizo qué y cuándo, sin duplicar el contenido del ticket.
-- =====================================================================
create table if not exists public.ticket_events (
  id          bigint generated always as identity primary key,
  ticket_id   uuid not null references public.service_tickets (id) on delete restrict,
  event_type  text not null check (event_type in
    ('created', 'assigned', 'reassigned', 'edited', 'started', 'attention_saved',
     'discrepancy_reported', 'completed', 'cancelled', 'reopened')),
  actor_id    uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  details     jsonb not null default '{}'::jsonb
);
create index if not exists ticket_events_ticket_idx on public.ticket_events (ticket_id, created_at, id);

-- Inmutable: ni UPDATE ni DELETE, ni siquiera desde las funciones.
create or replace function public.ticket_events_immutable()
returns trigger language plpgsql set search_path = public
as $$ begin raise exception 'La bitácora de eventos es inmutable' using errcode = '42501'; end; $$;
drop trigger if exists trg_ticket_events_immutable on public.ticket_events;
create trigger trg_ticket_events_immutable before update or delete on public.ticket_events
  for each row execute function public.ticket_events_immutable();

alter table public.ticket_events enable row level security;
revoke all on public.ticket_events from anon, authenticated;
grant select on public.ticket_events to authenticated;

drop policy if exists events_select on public.ticket_events;
create policy events_select on public.ticket_events
  for select to authenticated
  using (
    public.is_office()
    or (public.current_role_if_active() = 'technician'
        and exists (select 1 from public.service_tickets t where t.id = ticket_id and t.technician_id = auth.uid()))
  );
