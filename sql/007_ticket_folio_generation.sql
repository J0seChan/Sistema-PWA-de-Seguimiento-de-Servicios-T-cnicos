-- =====================================================================
-- Link Redes Servicios · 007_ticket_folio_generation.sql  (FASE 2)
-- Folio automático LR-AAAA-NNNNNN generado en PostgreSQL.
-- Ejecutar DESPUÉS de 006. Se puede ejecutar más de una vez.
--
-- Garantías:
--  * Único: restricción UNIQUE sobre service_tickets.folio.
--  * Sin colisiones concurrentes: el contador se incrementa con
--    INSERT ... ON CONFLICT DO UPDATE (bloquea la fila del año) dentro de la
--    misma transacción que crea el ticket. No se usa MAX()+1.
--  * Cambio de año: el contador es por año (hora de Ciudad de México);
--    el 1 de enero vuelve a empezar en 000001.
--  * Huecos: si la transacción falla se revierte también el contador, así que
--    normalmente no hay huecos. NO se garantiza numeración sin huecos
--    (p. ej. si alguien borra filas o edita el contador manualmente).
--    Los tickets cancelados conservan su folio.
--  * Folios existentes (SRV-…) NO se tocan. La numeración LR continúa desde
--    el contador del año actual (si hay N tickets de prueba, el primero LR será N+1).
-- =====================================================================
create or replace function public.next_folio()
returns text language plpgsql security definer set search_path = public
as $$
declare
  y integer := extract(year from (now() at time zone 'America/Mexico_City'))::integer;
  n integer;
begin
  insert into public.folio_counters (year, last_value) values (y, 1)
  on conflict (year) do update set last_value = public.folio_counters.last_value + 1
  returning last_value into n;
  return 'LR-' || y::text || '-' || lpad(n::text, 6, '0');
end;
$$;
revoke all on function public.next_folio() from public, anon, authenticated;

-- OPCIONAL (solo si los tickets de prueba ya se borraron y quieres empezar en LR-AAAA-000001):
--   update public.folio_counters set last_value = 0 where year = extract(year from (now() at time zone 'America/Mexico_City'))::integer;
