-- Pruebas de la fase 2 en PostgreSQL local con identidades simuladas (claims JWT).
-- Cualquier fallo detiene el script con "FALLO: <prueba>". Datos 100 % ficticios.
create schema if not exists t;
grant usage on schema t to authenticated, anon;

create or replace function t.as_user(uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false); end $$;
create or replace function t.ok(label text, cond boolean) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FALLO: %', label; end if; raise notice 'ok  %', label; end $$;
create or replace function t.err(label text, q text, expected text) returns void language plpgsql as $$
begin
  begin execute q;
  exception when others then
    if sqlstate = expected or sqlerrm like '%' || expected || '%' then raise notice 'ok  % [%]', label, sqlerrm; return; end if;
    raise exception 'FALLO: % -> error distinto: % (%)', label, sqlerrm, sqlstate;
  end;
  raise exception 'FALLO: % -> esperaba error "%" y la operación funcionó', label, expected;
end $$;
grant execute on all functions in schema t to authenticated, anon;

\set admin  '00000000-0000-0000-0000-0000000000ad'
\set disp   '00000000-0000-0000-0000-0000000000b2'
\set dispx  '00000000-0000-0000-0000-0000000000d9'
\set techA  '00000000-0000-0000-0000-0000000000a1'
\set techB  '00000000-0000-0000-0000-0000000000b3'
\set techX  '00000000-0000-0000-0000-0000000000e5'

-- 1. Creación automática de perfiles --------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  (:'admin', 'admin@test.local', '{"full_name":"Admin Prueba"}'),
  (:'dispx', 'dispx@test.local', '{}'),
  (:'techB', 'techb@test.local', '{"full_name":"Técnico B"}'),
  (:'techX', 'techx@test.local', '{}');
do $$ begin
  perform t.ok('perfil automático creado', (select count(*) from public.profiles where id in ('00000000-0000-0000-0000-0000000000ad','00000000-0000-0000-0000-0000000000b3')) = 2);
  perform t.ok('perfil automático nace INACTIVO y sin privilegios', (select bool_and(not active and role = 'technician') from public.profiles where id in ('00000000-0000-0000-0000-0000000000ad','00000000-0000-0000-0000-0000000000e5')));
  perform t.ok('nombre tomado de metadatos o del correo', (select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000b3') = 'Técnico B'
     and (select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000e5') = 'techx');
end $$;
-- Procedimiento controlado (SQL Editor / Edge Function): asignar roles y activar.
update public.profiles set role = 'admin', active = true where id = :'admin';
update public.profiles set role = 'technician', active = true where id = :'techB';
update public.profiles set role = 'dispatcher', active = false where id = :'dispx';
do $$ begin
  perform t.ok('supervisor migrado a dispatcher', (select role from public.profiles where id = '00000000-0000-0000-0000-0000000000b2') = 'dispatcher');
  perform t.ok('folios SRV- existentes se conservan', (select count(*) from public.service_tickets where folio like 'SRV-%') = 2);
  perform t.ok('ticket open heredado pasó a assigned', (select service_status from public.service_tickets where id = '10000000-0000-0000-0000-000000000001') = 'assigned');
end $$;

-- 2. Clientes ----------------------------------------------------------------------------
set role authenticated;
select t.as_user(:'disp');
insert into public.clients (id, pppoe_username, full_name, address, address_reference)
  values ('c0000000-0000-0000-0000-000000000001', '  Cliente.Uno  ', 'Cliente Uno', 'Calle Falsa 123', 'Casa azul');
select t.err('PPPoE duplicado (sin importar mayúsculas/espacios)', $q$insert into public.clients (pppoe_username, address) values ('cliente.UNO', 'x')$q$, '23505');
do $$ begin perform t.ok('PPPoE normalizado al guardar', (select pppoe_username from public.clients limit 1) = 'Cliente.Uno'); end $$;
select t.as_user(:'techA');
select t.err('técnico no puede crear clientes', $q$insert into public.clients (pppoe_username, address) values ('x', 'y')$q$, '42501');
do $$ begin
  perform t.ok('técnico activo puede leer clientes', (select count(*) from public.clients) = 1);
end $$;
do $$ declare n int; begin
  update public.clients set address = 'hack';
  get diagnostics n = row_count;
  perform t.ok('técnico no puede editar clientes (RLS filtra: 0 filas, dirección intacta)', n = 0 and (select address from public.clients where id = 'c0000000-0000-0000-0000-000000000001') = 'Calle Falsa 123');
end $$;
select t.as_user(:'dispx');
do $$ begin perform t.ok('oficina INACTIVA no lee clientes', (select count(*) from public.clients) = 0); end $$;
reset role;
insert into public.clients (id, pppoe_username, full_name, address) values ('c0000000-0000-0000-0000-000000000002', 'cliente.dos', 'Cliente Dos', 'Av. Ficticia 9');

-- 3. Crear tickets (oficina) -------------------------------------------------------------
set role authenticated;
select t.as_user(:'disp');
select * from public.create_ticket('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'failure', 'Sin internet desde ayer', :'techA', 'EXT-1');
select * from public.create_ticket('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'support', 'Lentitud', null, null);
do $$ declare r public.service_tickets; begin
  select * into r from public.service_tickets where id = 'd0000000-0000-0000-0000-000000000001';
  perform t.ok('folio automático con formato LR-AAAA-NNNNNN', r.folio ~ '^LR-[0-9]{4}-[0-9]{6}$');
  perform t.ok('ticket asignado con snapshot del cliente', r.service_status = 'assigned' and r.client_pppoe_snapshot = 'Cliente.Uno' and r.client_address_snapshot = 'Calle Falsa 123' and r.technician_name is not null and r.version = 1);
  perform t.ok('ticket sin técnico queda unassigned', (select service_status from public.service_tickets where id = 'd0000000-0000-0000-0000-000000000002') = 'unassigned');
  perform t.ok('reintentar create_ticket con el mismo id NO duplica', (select count(*) from public.create_ticket('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'failure', 'Sin internet desde ayer', '00000000-0000-0000-0000-0000000000a1'::uuid, null)) = 1
     and (select count(*) from public.service_tickets where id = 'd0000000-0000-0000-0000-000000000001') = 1);
  perform t.ok('evento created/assigned registrados', (select count(*) from public.ticket_events where ticket_id = 'd0000000-0000-0000-0000-000000000001') = 2);
end $$;
select t.err('técnico inactivo no puede recibir asignación', format($q$select * from public.create_ticket(gen_random_uuid(), 'c0000000-0000-0000-0000-000000000001', 'support', 'x', %L::uuid)$q$, :'techX'), 'technician_invalid');
select t.err('cliente inexistente', $q$select * from public.create_ticket(gen_random_uuid(), gen_random_uuid(), 'support', 'x')$q$, 'client_not_found');
select t.err('tipo de servicio inválido', $q$select * from public.create_ticket(gen_random_uuid(), 'c0000000-0000-0000-0000-000000000001', 'otro', 'x')$q$, '23514');
select t.err('problema vacío rechazado', $q$select * from public.create_ticket(gen_random_uuid(), 'c0000000-0000-0000-0000-000000000001', 'support', '   ')$q$, '23514');

select t.as_user(:'techA');
select t.err('técnico NO puede crear tickets (RPC)', $q$select * from public.create_ticket(gen_random_uuid(), 'c0000000-0000-0000-0000-000000000001', 'support', 'x')$q$, 'forbidden');
select t.err('técnico NO puede insertar directo', $q$insert into public.service_tickets (id, created_by, service_date, service_type, reported_problem, service_status) values (gen_random_uuid(), auth.uid(), now(), 'support', 'x', 'unassigned')$q$, '42501');
select t.err('técnico NO puede modificar folio (update directo)', $q$update public.service_tickets set folio = 'LR-0000-000000' where id = 'd0000000-0000-0000-0000-000000000001'$q$, '42501');
select t.err('técnico NO puede cambiar asignación ni con set_config falso', $q$select set_config('lr.rpc','1',true); update public.service_tickets set technician_id = auth.uid()$q$, '42501');
select t.err('técnico NO puede borrar', $q$delete from public.service_tickets$q$, '42501');
select t.err('técnico no puede asignar', $q$select * from public.assign_ticket('d0000000-0000-0000-0000-000000000002', auth.uid(), 1)$q$, 'forbidden');
select t.err('técnico no puede cancelar', $q$select * from public.cancel_ticket('d0000000-0000-0000-0000-000000000001', 1, 'x')$q$, 'forbidden');

-- 4. Visibilidad -------------------------------------------------------------------------
do $$ begin
  perform t.ok('técnico A ve su ticket asignado', (select count(*) from public.service_tickets where id = 'd0000000-0000-0000-0000-000000000001') = 1);
  perform t.ok('técnico A NO ve ticket sin asignar de oficina', (select count(*) from public.service_tickets where id = 'd0000000-0000-0000-0000-000000000002') = 0);
end $$;
select t.as_user(:'techB');
do $$ begin perform t.ok('técnico B NO ve tickets abiertos de A', (select count(*) from public.service_tickets where id = 'd0000000-0000-0000-0000-000000000001') = 0);
  perform t.ok('técnico B no ve eventos de tickets ajenos', (select count(*) from public.ticket_events) = 0); end $$;
select t.as_user(:'disp');
do $$ begin perform t.ok('oficina ve todos los tickets', (select count(*) from public.service_tickets) >= 4); end $$;
select t.as_user(:'dispx');
do $$ begin perform t.ok('oficina INACTIVA no ve tickets', (select count(*) from public.service_tickets) = 0); end $$;
select t.err('oficina INACTIVA no puede crear', $q$select * from public.create_ticket(gen_random_uuid(), 'c0000000-0000-0000-0000-000000000001', 'support', 'x')$q$, 'forbidden');

-- 5. Atención del técnico -----------------------------------------------------------------
select t.as_user(:'techA');
select * from public.save_ticket_attention('d0000000-0000-0000-0000-000000000001', 1, 'e0000000-0000-0000-0000-000000000001', 'in_progress', true, false, null, 'ONT sin potencia', null, null, null);
do $$ declare r public.service_tickets; begin
  select * into r from public.service_tickets where id = 'd0000000-0000-0000-0000-000000000001';
  perform t.ok('iniciar atención: en proceso, started_at, versión 2', r.service_status = 'in_progress' and r.started_at is not null and r.version = 2);
  perform t.ok('mismo operation_id repetido es idempotente (no sube versión)', (select version from public.save_ticket_attention('d0000000-0000-0000-0000-000000000001', 1, 'e0000000-0000-0000-0000-000000000001', 'in_progress', true, false, null, 'ONT sin potencia', null, null, null)) = 2);
end $$;
select t.err('versión vieja → version_conflict', $q$select * from public.save_ticket_attention('d0000000-0000-0000-0000-000000000001', 1, gen_random_uuid(), 'in_progress', true, true, null, 'x', null, null, null)$q$, 'version_conflict');
select t.err('completar sin acción/resultado', $q$select * from public.save_ticket_attention('d0000000-0000-0000-0000-000000000001', 2, gen_random_uuid(), 'completed', true, true, null, 'diag', null, null, null)$q$, 'completion_requirements');
select t.err('completar sin confirmar datos ni discrepancia', $q$select * from public.save_ticket_attention('d0000000-0000-0000-0000-000000000001', 2, gen_random_uuid(), 'completed', true, false, null, 'd', 'a', 'r', null)$q$, 'completion_requirements');
select t.as_user(:'techB');
select t.err('otro técnico no puede registrar atención', $q$select * from public.save_ticket_attention('d0000000-0000-0000-0000-000000000001', 2, gen_random_uuid(), 'in_progress', true, true, null, 'hack', null, null, null)$q$, 'not_assigned');
select t.err('técnico no puede tocar ticket sin asignar', $q$select * from public.save_ticket_attention('d0000000-0000-0000-0000-000000000002', 1, gen_random_uuid(), 'in_progress', true, true, null, 'hack', null, null, null)$q$, 'not_assigned');
select t.as_user(:'techA');
select * from public.save_ticket_attention('d0000000-0000-0000-0000-000000000001', 2, 'e0000000-0000-0000-0000-000000000002', 'completed', true, false, 'La dirección real es otra calle', 'Fibra doblada', 'Se reemplazó el acoplador', 'Servicio restablecido', 'ok');
do $$ declare r public.service_tickets; begin
  select * into r from public.service_tickets where id = 'd0000000-0000-0000-0000-000000000001';
  perform t.ok('completado con discrepancia registrada; datos originales intactos', r.service_status = 'completed' and r.completed_at is not null and r.client_address_snapshot = 'Calle Falsa 123' and r.discrepancy_notes is not null);
  perform t.ok('eventos started/discrepancy/completed', (select count(*) from public.ticket_events where ticket_id = r.id and event_type in ('started','discrepancy_reported','completed')) = 3);
end $$;
select t.err('ticket completado ya no admite cambios del técnico', $q$select * from public.save_ticket_attention('d0000000-0000-0000-0000-000000000001', 3, gen_random_uuid(), 'in_progress', true, true, null, 'x', null, null, null)$q$, 'ticket_closed');

-- 6. Historial global ---------------------------------------------------------------------
select t.as_user(:'techB');
do $$ begin
  perform t.ok('técnico B ve el historial COMPLETADO atendido por A', (select count(*) from public.service_tickets where client_id = 'c0000000-0000-0000-0000-000000000001' and service_status = 'completed') = 1);
  perform t.ok('historial: el técnico B no ve los datos privados de otros estados', (select count(*) from public.service_tickets where service_status <> 'completed') = 0);
end $$;

-- 7. Asignación / reasignación ---------------------------------------------------------------
select t.as_user(:'disp');
select * from public.assign_ticket('d0000000-0000-0000-0000-000000000002', :'techA', 1);
do $$ declare v int; begin
  select version into v from public.service_tickets where id = 'd0000000-0000-0000-0000-000000000002';
  perform t.ok('asignar ticket sin técnico', (select service_status from public.service_tickets where id = 'd0000000-0000-0000-0000-000000000002') = 'assigned' and v = 2);
  perform t.err('asignar con versión vieja', $q$select * from public.assign_ticket('d0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b3', 1)$q$, 'version_conflict');
  perform t.err('no asignar a técnico inactivo', $q$select * from public.assign_ticket('d0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e5', 2)$q$, 'technician_invalid');
end $$;
select t.as_user(:'techA');
select * from public.save_ticket_attention('d0000000-0000-0000-0000-000000000002', 2, gen_random_uuid(), 'in_progress', true, true, null, 'borrador de diagnóstico', null, null, null);
select t.as_user(:'disp');
select t.err('reasignar EN PROCESO exige motivo', $q$select * from public.assign_ticket('d0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b3', 3)$q$, 'reason_required');
select * from public.assign_ticket('d0000000-0000-0000-0000-000000000002', :'techB', 3, 'Técnico A sin cobertura');
do $$ declare r public.service_tickets; begin
  select * into r from public.service_tickets where id = 'd0000000-0000-0000-0000-000000000002';
  perform t.ok('reasignado: regresa a assigned, conserva borrador y registra evento', r.service_status = 'assigned' and r.technician_id = '00000000-0000-0000-0000-0000000000b3' and r.diagnosis = 'borrador de diagnóstico' and r.started_at is null
    and (select details->>'reason' from public.ticket_events where ticket_id = r.id and event_type = 'reassigned') = 'Técnico A sin cobertura');
end $$;
select t.as_user(:'techA');
select t.err('técnico A ya no puede guardar (reasignado)', $q$select * from public.save_ticket_attention('d0000000-0000-0000-0000-000000000002', 4, gen_random_uuid(), 'in_progress', true, true, null, 'tarde', null, null, null)$q$, 'not_assigned');

-- 8. Cancelar / reabrir / editar --------------------------------------------------------------
select t.as_user(:'disp');
select t.err('cancelar exige motivo', $q$select * from public.cancel_ticket('d0000000-0000-0000-0000-000000000002', 4, '')$q$, 'reason_required');
select * from public.update_ticket_office('d0000000-0000-0000-0000-000000000002', 4, 'expansion', 'Lentitud en horario nocturno', 'EXT-2');
select * from public.cancel_ticket('d0000000-0000-0000-0000-000000000002', 5, 'Cliente canceló');
select t.as_user(:'techB');
do $$ begin perform t.ok('cancelado de otro/propio ya no es visible como historial al técnico B? (es suyo: lo ve)', (select count(*) from public.service_tickets where id = 'd0000000-0000-0000-0000-000000000002') = 1); end $$;
select t.err('técnico no puede guardar atención en ticket cancelado', $q$select * from public.save_ticket_attention('d0000000-0000-0000-0000-000000000002', 6, gen_random_uuid(), 'in_progress', true, true, null, 'x', null, null, null)$q$, 'ticket_closed');
select t.as_user(:'techA');
do $$ begin perform t.ok('tickets cancelados ajenos no se exponen al historial', (select count(*) from public.service_tickets where id = 'd0000000-0000-0000-0000-000000000002') = 0); end $$;
select t.as_user(:'disp');
select * from public.reopen_ticket('d0000000-0000-0000-0000-000000000002', 6, 'Cliente reactivó');
do $$ begin perform t.ok('reabierto vuelve a assigned', (select service_status from public.service_tickets where id = 'd0000000-0000-0000-0000-000000000002') = 'assigned'); end $$;

-- 9. Bitácora inmutable -----------------------------------------------------------------------
select t.err('eventos: UPDATE directo denegado', $q$update public.ticket_events set event_type = 'created'$q$, '42501');
select t.err('eventos: DELETE directo denegado', $q$delete from public.ticket_events$q$, '42501');
reset role;
select t.err('eventos inmutables incluso para el dueño', $q$delete from public.ticket_events$q$, 'inmutable');

-- 10. Perfiles / roles ------------------------------------------------------------------------
set role authenticated;
select t.as_user(:'techA');
select t.err('técnico no puede cambiarse el rol', $q$update public.profiles set role = 'admin' where id = auth.uid()$q$, '42501');
select t.err('técnico no puede reactivarse/activarse', $q$update public.profiles set active = true where id = auth.uid()$q$, '42501');
update public.profiles set full_name = 'Técnico A Renombrado' where id = auth.uid();
do $$ begin
  perform t.ok('técnico puede cambiar solo su nombre', (select full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000a1') = 'Técnico A Renombrado');
  perform t.ok('técnico solo ve su propio perfil', (select count(*) from public.profiles) = 1);
end $$;
select t.as_user(:'admin');
select t.err('ni el admin cambia roles por la API (solo Edge Function)', $q$update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b3'$q$, '42501');
do $$ begin perform t.ok('admin ve todos los perfiles', (select count(*) from public.profiles) >= 6); end $$;
select t.as_user(:'disp');
do $$ begin perform t.ok('oficina ve técnicos pero no otros perfiles de oficina/admin', (select count(*) from public.profiles where role <> 'technician') = 1 -- solo el suyo
   and (select count(*) from public.profiles where role = 'technician') >= 2); end $$;

-- 11. anon ----------------------------------------------------------------------------------
reset role; set role anon;
select t.err('anon no lee tickets', $q$select * from public.service_tickets$q$, '42501');
select t.err('anon no lee clientes', $q$select * from public.clients$q$, '42501');
select t.err('anon no ejecuta create_ticket', $q$select * from public.create_ticket(gen_random_uuid(), gen_random_uuid(), 'support', 'x')$q$, '42501');
select t.err('anon no ejecuta next_folio', $q$select public.next_folio()$q$, '42501');
reset role; set role authenticated; select t.as_user(:'disp');
select t.err('authenticated no ejecuta next_folio', $q$select public.next_folio()$q$, '42501');
reset role;
\echo === TODAS LAS PRUEBAS SQL PASARON ===
