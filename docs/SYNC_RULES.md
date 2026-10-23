# Reglas de sincronización (técnico)

Resumen: ver `docs/OFFLINE_AND_CONFLICTS.md`. Detalles del motor (`src/services/sync/engine.ts`):

- **Disparadores**: al abrir, al volver la conexión, al volver al primer plano, tras guardar, botón *Sincronizar ahora* y un temporizador de un solo disparo hacia el próximo reintento (solo con la app visible).
- **Cola**: una operación vigente por ticket, procesada en secuencia, con candado contra ejecuciones concurrentes. Solo se elimina tras confirmación del servidor.
- **Estados locales** (independientes del estado del ticket): `pending`, `syncing`, `synced`, `error`.
- **Pull**: tras un envío exitoso se descargan los tickets del técnico con **paginación completa** (sin tope silencioso). No pisa tickets con cambios locales; los sincronizados que fueron reasignados salen del dispositivo.
- **Operación**: solo existe `save_ticket_attention`. El técnico no crea tickets.
