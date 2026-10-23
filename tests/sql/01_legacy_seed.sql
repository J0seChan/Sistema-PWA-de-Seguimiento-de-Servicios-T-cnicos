-- Datos "heredados" como los que existen hoy en tu base (fase 1) para probar la migración sobre datos reales.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'tecA@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'sup@test.local'),
  ('00000000-0000-0000-0000-0000000000c3', 'sinperfil@test.local')
on conflict do nothing;
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Técnico viejo', 'technician'),
  ('00000000-0000-0000-0000-0000000000b2', 'Supervisor viejo', 'supervisor')
on conflict do nothing;
insert into public.service_tickets (id, created_by, technician_id, service_date, service_type, reported_problem, service_status, diagnosis, action_taken, result)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', now(), 'support', 'Prueba abierta', 'open', null, null, null),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', now(), 'failure', 'Prueba completada', 'completed', 'd', 'a', 'r')
on conflict do nothing;
