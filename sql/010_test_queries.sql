-- =====================================================================
-- Link Redes Servicios · 010_test_queries.sql  (FASE 2)
-- Verificaciones MANUALES para el SQL Editor de Supabase. Cada bloque termina en ROLLBACK:
-- no deja datos. Reemplaza los marcadores por UUID reales de TUS usuarios de prueba
-- (Authentication > Users; consulta sus roles con: select id, full_name, role, active from public.profiles):
--   UUID_OFICINA   → usuario con rol dispatcher activo
--   UUID_TECNICO_A → técnico activo       UUID_TECNICO_B → otro técnico activo
--   UUID_INACTIVO  → usuario con active = false
--   UUID_CLIENTE   → opcional: se crea dentro de la transacción
-- Estas pruebas simulan la identidad con claims JWT. Las pruebas finales deben hacerse además
-- desde la PWA con cada rol (ver docs/ROLES_AND_SECURITY.md).
-- =====================================================================

-- A. Oficina crea ticket: folio LR-AAAA-NNNNNN y asignación ----------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"UUID_OFICINA","role":"authenticated"}', true);
  insert into public.clients (id, pppoe_username, address) values ('11111111-1111-1111-1111-111111111111', 'prueba.rls', 'Calle de prueba 1');
  select folio, service_status, technician_name, version
    from public.create_ticket('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'support', 'Prueba RLS', 'UUID_TECNICO_A');
  -- ESPERADO: 1 fila, folio LR-2026-… , service_status = assigned, version = 1
rollback;

-- B. Un técnico NO puede crear ni insertar tickets -------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"UUID_TECNICO_A","role":"authenticated"}', true);
  select * from public.create_ticket(gen_random_uuid(), gen_random_uuid(), 'support', 'x');
  -- ESPERADO: ERROR 42501 forbidden
rollback;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"UUID_TECNICO_A","role":"authenticated"}', true);
  insert into public.service_tickets (id, created_by, service_date, service_type, reported_problem, service_status)
  values (gen_random_uuid(), 'UUID_TECNICO_A', now(), 'support', 'x', 'unassigned');
  -- ESPERADO: ERROR 42501 permission denied for table service_tickets
rollback;

-- C. Un técnico NO puede modificar folio / cliente / asignación (ni por UPDATE directo) ----
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"UUID_TECNICO_A","role":"authenticated"}', true);
  update public.service_tickets set folio = 'LR-0000-000000';
  -- ESPERADO: ERROR 42501 permission denied for table service_tickets
rollback;

-- D. El técnico asignado registra su atención; otro técnico no puede -------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"UUID_OFICINA","role":"authenticated"}', true);
  insert into public.clients (id, pppoe_username, address) values ('11111111-1111-1111-1111-111111111111', 'prueba.rls', 'Calle de prueba 1');
  select * from public.create_ticket('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'support', 'Prueba', 'UUID_TECNICO_A');

  select set_config('request.jwt.claims', '{"sub":"UUID_TECNICO_B","role":"authenticated"}', true);
  select * from public.save_ticket_attention('22222222-2222-2222-2222-222222222222', 1, gen_random_uuid(), 'in_progress', true, true, null, 'hack', null, null, null);
  -- ESPERADO: ERROR 42501 not_assigned
rollback;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"UUID_OFICINA","role":"authenticated"}', true);
  insert into public.clients (id, pppoe_username, address) values ('11111111-1111-1111-1111-111111111111', 'prueba.rls', 'Calle de prueba 1');
  select * from public.create_ticket('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'support', 'Prueba', 'UUID_TECNICO_A');
  select set_config('request.jwt.claims', '{"sub":"UUID_TECNICO_A","role":"authenticated"}', true);
  select service_status, version from public.save_ticket_attention('22222222-2222-2222-2222-222222222222', 1, gen_random_uuid(), 'in_progress', true, true, null, 'ONT sin potencia', null, null, null);
  -- ESPERADO: in_progress, version 2
rollback;

-- E. Historial global: el técnico B ve tickets COMPLETADOS de otros, pero no sus abiertos ---
-- (revisa con tus datos reales) select service_status, count(*) from public.service_tickets group by 1;
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"UUID_TECNICO_B","role":"authenticated"}', true);
  select service_status, count(*) from public.service_tickets where technician_id is distinct from 'UUID_TECNICO_B' group by 1;
  -- ESPERADO: solo aparece la fila 'completed' (si existe); ningún assigned / in_progress / unassigned / cancelled ajeno
rollback;

-- F. Usuario inactivo no puede operar -------------------------------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"UUID_INACTIVO","role":"authenticated"}', true);
  select count(*) as tickets_visibles from public.service_tickets;     -- ESPERADO: 0
  select count(*) as clientes_visibles from public.clients;            -- ESPERADO: 0
  select * from public.create_ticket(gen_random_uuid(), gen_random_uuid(), 'support', 'x');  -- ESPERADO: ERROR forbidden
rollback;

-- G. Nadie cambia su propio rol (ni activa su cuenta) desde la API ------------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"UUID_TECNICO_A","role":"authenticated"}', true);
  update public.profiles set role = 'admin' where id = 'UUID_TECNICO_A';
  -- ESPERADO: ERROR 42501 permission denied for table profiles (columna role no concedida)
rollback;

-- H. anon no accede a nada -------------------------------------------------------------------------
begin;
  set local role anon;
  select count(*) from public.service_tickets;   -- ESPERADO: ERROR 42501 permission denied
rollback;

-- I. Los folios existen y son únicos ---------------------------------------------------------------
select count(*) as tickets, count(distinct folio) as folios_distintos from public.service_tickets;  -- deben coincidir
-- Funciones SECURITY DEFINER y su search_path fijo:
select p.proname, p.prosecdef as security_definer, p.proconfig as config
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef order by 1;   -- todas deben mostrar search_path=public
