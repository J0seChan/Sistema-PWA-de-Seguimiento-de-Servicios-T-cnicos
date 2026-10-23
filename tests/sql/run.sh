#!/usr/bin/env bash
# Prueba las migraciones en un PostgreSQL LOCAL (no es Supabase). Requiere psql y un servidor accesible.
# Uso: PGHOST=localhost PGUSER=postgres PGPASSWORD=... bash tests/sql/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${DB:-lrtest}; Q="psql -v ON_ERROR_STOP=1 -q -d $DB"
dropdb --if-exists "$DB" && createdb "$DB"
$Q -f tests/sql/00_fake_supabase.sql
for f in 001_schema 002_functions_and_triggers 003_rls_policies; do $Q -f sql/$f.sql 2>&1 | grep -v NOTICE || true; done
$Q -f tests/sql/01_legacy_seed.sql          # datos de la fase 1
for f in 005_roles_and_profiles 006_clients_and_ticket_fields 007_ticket_folio_generation 008_ticket_events 009_ticket_rpc_and_rls; do $Q -f sql/$f.sql 2>&1 | grep -v NOTICE || true; done
echo "-- re-ejecución de migraciones (idempotencia) --"
for f in 005_roles_and_profiles 006_clients_and_ticket_fields 007_ticket_folio_generation 008_ticket_events 009_ticket_rpc_and_rls; do $Q -f sql/$f.sql 2>&1 | grep -v NOTICE || true; done
$Q -f tests/sql/02_phase2_tests.sql 2>&1 | grep -E "FALLO|ERROR|===|ok " | sed 's/^psql:[^ ]* //'
echo "-- concurrencia de folios: 8 sesiones x 5 tickets --"
for i in 1 2 3 4 5 6 7 8; do
  ( psql -q -d "$DB" -v ON_ERROR_STOP=1 <<SQL >/dev/null
set role authenticated; select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-0000000000b2"}',false);
select public.create_ticket(gen_random_uuid(), 'c0000000-0000-0000-0000-000000000001', 'support', 'concurrencia') from generate_series(1,5);
SQL
  ) & done; wait
psql -tA -d "$DB" -c "select 'tickets LR concurrentes: ' || count(*) || ' | folios distintos: ' || count(distinct folio) from service_tickets where reported_problem = 'concurrencia'"
