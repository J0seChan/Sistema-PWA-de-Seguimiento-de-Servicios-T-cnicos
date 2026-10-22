# Reglas de sincronización

**Disparadores**: al abrir la app, al volver la conexión (`online`), al volver al primer plano, tras guardar/editar, botón *Sincronizar ahora*, y un único temporizador de un disparo hacia el próximo reintento (solo con la app visible). No depende de Background Sync ni mantiene el teléfono despierto.

**Cola**: una operación vigente por servicio (`create` o `update`), secuencial, con candado contra ejecuciones concurrentes. Solo se elimina tras confirmación válida. Un registro pasa a `synced` únicamente en esa confirmación.

**Idempotencia**: el UUID no cambia nunca. Si hubo un intento previo de `create`, se consulta el servidor antes de reenviar; un `23505` (UUID ya existe) se reconoce como creación ya confirmada. Respuesta perdida ⇒ no hay duplicado.

**Reintentos**: 2 s → 5 s → 15 s → 1 min → 5 min (tope), ±20 % de variación.

| Error | Tratamiento |
|---|---|
| Sin conexión | Conserva, reintenta con espera, detiene la ronda |
| Sesión expirada | Conserva, detiene la ronda, pide iniciar sesión |
| Permiso denegado | Bloquea reintentos automáticos; solo *Sincronizar ahora* |
| Validación | Estado `error`, bloqueado; el usuario corrige y vuelve a guardar |
| Conflicto de versión | Conserva lo local, guarda la versión remota, el usuario elige |
| Temporal (5xx/429) | Reintento con espera |
| Desconocido | Bloquea hasta reintento manual |

Ningún error borra datos locales.

**Conflictos**: la actualización envía `version` esperada (`update … where version = N`). Si no coincide, nada se sobrescribe; el detalle del servicio ofrece *Conservar mis cambios* (reenvía sobre la versión actual) o *Usar la del servidor*.

**Edición durante el envío**: si el técnico edita mientras se envía, al confirmar queda una actualización pendiente con la última versión.

**Descarga**: tras un envío exitoso se traen los servicios visibles según RLS; nunca se pisa un registro con cambios locales pendientes.
