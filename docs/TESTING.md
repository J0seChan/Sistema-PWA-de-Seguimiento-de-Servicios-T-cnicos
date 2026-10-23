# Pruebas

## Automáticas — `npm test` (Vitest + fake-indexeddb)
**43 pruebas, todas pasan** (última ejecución en el desarrollo). Usan un **servidor simulado**, no Supabase.
- Cola local, persistencia al reabrir la base, edición de pendientes sin duplicar, separación por propietario.
- Sincronización: confirmación, backoff, **respuesta perdida sin duplicar** (incluida la variante con edición intermedia), sesión expirada, usuario distinto, permisos, validación, edición durante el envío, recuperación de `syncing`, cierre offline.
- Conflictos: oficina edita, dos dispositivos, **reasignación** (visible e invisible), cancelación, ambas resoluciones, edición bloqueada con conflicto.
- Descarga de tickets (no pisa cambios locales, retira reasignados).
- Validaciones y vistas (escape de HTML, separación problema/diagnóstico, navegación y acciones por rol).

## SQL — `bash tests/sql/run.sh` (PostgreSQL 16 local)
Recrea la base, simula `auth.uid()`/roles de Supabase con claims JWT, aplica `001`–`003`, siembra datos de la fase 1, aplica `005`–`009` **dos veces** (idempotencia) y ejecuta **73 comprobaciones**: perfiles automáticos, migración de datos heredados, RLS por rol, funciones de escritura, versión/idempotencia, reasignación, cancelación/reapertura, bitácora inmutable, permisos de `anon`/`authenticated`, usuarios inactivos, y **concurrencia: 8 sesiones × 5 tickets → 40 folios distintos**. Resultado: todo pasó.
Limitación: es PostgreSQL real, pero **no es Supabase**: no pasa por PostgREST/GoTrue ni por el JWT real.

## NO ejecutado — requiere tu entorno
- Las migraciones y `sql/010_test_queries.sql` en **tu proyecto Supabase real**.
- La **Edge Function** `admin-users` (no hay Deno en el entorno de desarrollo): despliégala y prueba crear usuario / cambiar rol / desactivar.
- Pruebas end-to-end en navegador, instalación y uso offline en **Android**, impresión/PDF, pantallas 360–430 px, claro/oscuro, y las formas de respuesta de PostgREST con `rpc()` (el código acepta objeto o arreglo).
- Revisar secretos: `grep -rn service_role src/` no debe devolver nada (solo aparece en la Edge Function, en el servidor).
