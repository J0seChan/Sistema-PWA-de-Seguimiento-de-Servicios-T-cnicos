# Modelo de datos

## Supabase (`sql/001_schema.sql`)
- `profiles(id → auth.users, full_name, role technician|supervisor|admin, active, created_at, updated_at)`
- `service_tickets(id uuid [lo genera el dispositivo], folio único [servidor], created_by, technician_id, external_ticket_ref, service_date, service_type, reported_problem, diagnosis, action_taken, result, service_status, observations, created_at, updated_at, version)`
- `folio_counters(year, last_value)` — interno, sin acceso para clientes.

Tipos: `installation` Instalación · `support` Soporte · `failure` Falla · `expansion` Ampliación · `address_change` Cambio de domicilio · `modem_change` Cambio de módem.
Estados: `open` Abierto · `in_progress` En proceso · `completed` Completado.
El estado del servicio es independiente del estado de sincronización.

## IndexedDB (`linkredes_services`)
- `tickets` (clave `id`, índice `ownerId`): campos del servicio + `syncStatus` (pending|syncing|synced|error), `syncAttempts`, `lastSyncAttemptAt`, `lastSyncError`, `lastSyncErrorKind`, `localUpdatedAt`, `serverUpdatedAt`, `ownerId`, `localVersion`, `version` (última confirmada por el servidor), `conflictRemote`, `technicianName`.
- `sync_queue` (clave `operationId`, índice único `ticketId`, índice `ownerId`): `operationType` create|update, `attempts`, `nextAttemptAt`, `lastError`, `payloadVersion`.
