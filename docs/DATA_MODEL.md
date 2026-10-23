# Modelo de datos (fase 2)

## Supabase
- `profiles(id, full_name, role technician|dispatcher|admin, active, …)` — creado automáticamente (inactivo) por `handle_new_user` al crear un usuario de Auth.
- `clients(id, pppoe_username, pppoe_key [normalizado, único], full_name, address, address_reference, contact_phone, created_by, created_at, updated_at, version)` — el id es estable aunque cambie el PPPoE.
- `service_tickets` — conserva todo lo de la fase 1 y añade: `technician_id` ahora **nullable**, `technician_name`, `client_id` (FK `on delete restrict`), `client_*_snapshot` (PPPoE, nombre, dirección, referencias originales: inmutables), `assigned_at`, `started_at`, `completed_at`, `pppoe_confirmed`, `address_confirmed`, `discrepancy_notes`, `last_operation_id`.
  - Estados: `unassigned` Pendiente de asignación → `assigned` Asignado → `in_progress` En proceso → `completed` Completado; `cancelled` Cancelado (necesario porque no hay borrado físico). No se agregó prioridad (no se justificó).
  - Constraints: asignación coherente con el estado; completado exige diagnóstico, acción, resultado, `completed_at` y confirmaciones o discrepancia; tickets nuevos exigen cliente (los de prueba antiguos quedan exentos con `NOT VALID`).
  - Índices: por cliente, por técnico+estado, por estado+fecha, por fecha, `folio` único.
- `ticket_events(id, ticket_id, event_type, actor_id, created_at, details jsonb)` — inmutable (trigger + sin permisos de escritura); solo guarda quién/qué/cuándo y motivos, sin copiar el ticket.
- `folio_counters(year, last_value)` — interno.

## Folio `LR-AAAA-NNNNNN`
Generado en PostgreSQL por `next_folio()` (contador por año, hora de Ciudad de México) dentro de la transacción del ticket; único por constraint. Sin `MAX()+1`. El contador se revierte con la transacción, así que normalmente no hay huecos, **pero no se garantiza** numeración sin huecos (borrados o ediciones manuales). Al cambiar de año reinicia en 000001. Los folios `SRV-` existentes no se tocan.

## IndexedDB `linkredes_services` (v2)
- `tickets` (índice `ownerId`): ticket del servidor + `syncStatus`, `syncAttempts`, `lastSyncAttemptAt`, `lastSyncError(Kind)`, `localUpdatedAt`, `serverUpdatedAt`, `localVersion`, `hasLocalChanges`, `conflict {reason, remote}`.
- `sync_queue` (índices únicos `ticketId`, `ownerId`): `operationId`, `attempts`, `nextAttemptAt`, `lastError`, `payloadVersion`, `attemptOperationId`, `attemptLocalVersion`.
