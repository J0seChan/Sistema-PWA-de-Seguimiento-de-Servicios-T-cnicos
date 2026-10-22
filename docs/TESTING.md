# Pruebas

`npm test` (Vitest + fake-indexeddb). Resultado de la última ejecución en el entorno de desarrollo: **26 pruebas, todas pasando**.

## Cubierto (servidor simulado, sin Supabase real)
- Guardado local, persistencia tras cerrar/reabrir la base, edición de pendientes sin duplicar, separación por propietario.
- Sincronización: confirmación y folio, sin conexión con espera progresiva, **respuesta perdida sin duplicado**, sesión expirada, usuario distinto, permiso denegado (bloqueo y reintento manual), validación, edición durante envío, recuperación de `syncing`.
- Conflictos de versión y sus dos resoluciones.
- Backoff, clasificación de errores, validación por estado, escape de HTML y renderizado de vistas.

## Pendiente de validar por el propietario (requiere tu Supabase)
- Ejecutar los SQL: **no se ejecutaron contra PostgreSQL en el desarrollo**; revísalos y corre `sql/004_test_queries.sql`.
- Integración real: inicio de sesión, crear/sincronizar/actualizar, RLS con dos técnicos, folios.
- Pruebas de dispositivo: instalación y uso offline en Android, impresión/guardado PDF de la ficha, pantallas de 360–430 px, modo claro/oscuro. **No se ejecutaron pruebas e2e (Playwright) ni en navegador real** en el entorno de desarrollo.
- Revisar que no haya secretos: `grep -r service_role src/` no debe devolver nada.
