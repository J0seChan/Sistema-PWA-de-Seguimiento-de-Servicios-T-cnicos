# Funcionamiento sin conexión y conflictos

## Qué funciona offline (técnico)
- Abrir la PWA, ver los **tickets descargados** (asignados + completados de los últimos 14 días).
- **Capturar atención**: confirmaciones, discrepancias, diagnóstico, acción, resultado, observaciones, iniciar y completar. Se guarda primero en IndexedDB y entra a una cola persistente (sobrevive al cierre de la app).
- Imprimir la ficha de un ticket descargado.

## Qué requiere conexión (documentado en la interfaz)
- **Todo el panel de oficina y admin**: crear tickets, asignar, buscar clientes, usuarios. Decisión: un ticket creado offline por oficina no tendría folio ni asignación válidos, y oficina trabaja con red. El `id` del ticket se genera una vez por formulario, así que **reintentar tras un fallo de red no duplica**.
- **Historial global de clientes** (búsqueda, paginación, tickets de otros técnicos): se consulta en el servidor. La pantalla lo avisa.
- Sin conexión no se afirma que algo se haya "enviado": la interfaz distingue **guardado en el dispositivo** de **confirmado en el servidor**.
- No hay sincronización con la app cerrada (no se implementó Background Sync).

## Idempotencia
Cada envío lleva un `operation_id`; el servidor guarda `last_operation_id` y, si recibe el mismo, devuelve el ticket sin volver a aplicar. Antes de reintentar un envío de resultado incierto, la app consulta el ticket: si el servidor ya aplicó ese `operation_id`, lo da por confirmado; si además el técnico editó después, envía lo nuevo encima de la versión que ya quedó.

## Escenarios de conflicto
| Escenario | Qué pasa | Qué ve el técnico |
|---|---|---|
| Oficina **reasigna** mientras el técnico está offline | El servidor rechaza (`not_assigned`); nada se sobrescribe | "Ticket reasignado". Sus notas siguen guardadas; solo puede **descartar** (si ya no lo ve, sale del dispositivo) |
| Oficina **edita datos** del ticket (o del cliente) | Datos de oficina y atención son campos distintos. Editar el ticket sube la versión → conflicto de versión. Editar al cliente no afecta a la copia del ticket | "Oficina modificó este ticket": **Conservar mis notas** (toma los datos de oficina del servidor y reenvía solo la atención) o descartar |
| **Dos dispositivos** actualizan el mismo ticket | El segundo recibe conflicto de versión | Ve la versión del servidor y decide |
| Oficina **cancela/completa** mientras tanto | Se detecta por el estado remoto | "Oficina cerró o canceló": solo descartar (se adopta la versión del servidor) |
| Técnico **cierra offline** y falla el envío | El ticket queda "completado" localmente, pendiente; se reintenta con espera progresiva (2 s → 5 s → 15 s → 1 min → 5 min) | Etiqueta "Pendiente de sincronizar" |
| **Respuesta perdida** tras guardarse | Ver Idempotencia | Se confirma sin duplicar |

Descartar siempre es una acción **explícita** con confirmación. Ningún error borra datos locales.

## Errores y reintentos
Sin conexión / error temporal → reintento con espera; sesión expirada → pide iniciar sesión y conserva todo; permisos / validación / desconocido → se bloquea hasta "Sincronizar ahora".

## Migración de la base local
La base local pasó a la versión 2. Los registros de la fase 1 (tickets de prueba creados por técnicos, incompatibles) se descartan una sola vez al abrir la nueva versión.
