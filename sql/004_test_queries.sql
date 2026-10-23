-- ⚠ OBSOLETO desde la fase 2: estas pruebas asumen que el técnico inserta tickets directamente,
-- cosa que 009_ticket_rpc_and_rls.sql ya no permite. Usa sql/010_test_queries.sql.
-- =====================================================================
-- Link Redes Servicios · 004_test_queries.sql
-- Verificaciones MANUALES de RLS desde el editor SQL de Supabase.
-- Reemplaza los UUID por los de tus usuarios de prueba (Authentication > Users).
-- Cada bloque se ejecuta en una transacción que termina con ROLLBACK:
-- no deja datos. NO ejecutar en producción con usuarios reales sin revisar.
-- =====================================================================

-- Suplanta a un usuario autenticado dentro de la transacción actual.
-- (helper temporal; vive solo en esta sesión)
-- Uso: select set_config('request.jwt.claims', '{"sub":"<UUID>","role":"authenticated"}', true);

-- ---- A. El técnico A puede crear y leer su servicio -------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"UUID_TECNICO_A","role":"authenticated"}', true);

  insert into public.service_tickets (id, created_by, technician_id, service_date, service_type, reported_problem, service_status)
  values (gen_random_uuid(), 'UUID_TECNICO_A', 'UUID_TECNICO_A', now(), 'support', 'Prueba RLS', 'open')
  returning id, folio, version;                 -- ESPERADO: 1 fila con folio SRV-AAAA-000001 y version 1

  select count(*) as mis_servicios from public.service_tickets;   -- ESPERADO: >= 1
rollback;

-- ---- B. No se puede falsificar created_by / technician_id --------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"UUID_TECNICO_A","role":"authenticated"}', true);

  insert into public.service_tickets (id, created_by, technician_id, service_date, service_type, reported_problem, service_status)
  values (gen_random_uuid(), 'UUID_TECNICO_B', 'UUID_TECNICO_B', now(), 'support', 'Falsificado', 'open');
  -- ESPERADO: ERROR 42501 new row violates row-level security policy
rollback;

-- ---- C. El técnico B no ve los servicios del técnico A -----------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"UUID_TECNICO_B","role":"authenticated"}', true);
  select count(*) as servicios_ajenos_visibles from public.service_tickets where technician_id = 'UUID_TECNICO_A';
  -- ESPERADO: 0
rollback;

-- ---- D. Un técnico no puede cambiarse el rol ---------------------------
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"UUID_TECNICO_A","role":"authenticated"}', true);
  update public.profiles set role = 'admin' where id = 'UUID_TECNICO_A';
  -- ESPERADO: ERROR 42501 permission denied for table profiles (columna role no concedida)
rollback;

-- ---- E. Sin sesión (anon) no hay acceso --------------------------------
begin;
  set local role anon;
  select count(*) from public.service_tickets;
  -- ESPERADO: ERROR 42501 permission denied for table service_tickets
rollback;

-- ---- F. El folio y el creador no se pueden modificar -------------------
-- (ejecutar con un servicio existente del técnico A)
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"UUID_TECNICO_A","role":"authenticated"}', true);
  update public.service_tickets set folio = 'SRV-9999-000001' where technician_id = 'UUID_TECNICO_A';
  -- ESPERADO: ERROR 42501 Campos de identidad inmutables (o 0 filas si no hay servicios)
rollback;
