# Configuración de Supabase — Fase 2

La fase 1 (proyecto, claves, `001`–`003`) ya la hiciste. Esta guía añade **oficina, clientes, asignación, folios `LR-` y administración de usuarios**. Todo se ejecuta **a mano**: la aplicación y estos archivos no tocan Supabase por su cuenta.

> ⚠ Antes de empezar haz un respaldo (*Database → Backups*, o exporta tus tablas). Las migraciones **modifican datos**: los perfiles `supervisor` pasan a `dispatcher` y los tickets `open` pasan a `assigned`. No borran nada.

## 1. Ejecutar las migraciones (SQL Editor, en este orden)

Abre cada archivo de `sql/`, copia **todo** su contenido y pulsa **Run**. Cada una se puede ejecutar más de una vez.

| # | Archivo | Qué hace |
|---|---|---|
| 1 | `005_roles_and_profiles.sql` | Roles `technician`/`dispatcher`/`admin`; `supervisor`→`dispatcher`; **creación automática de perfiles** (inactivos); relleno de usuarios sin perfil |
| 2 | `006_clients_and_ticket_fields.sql` | Tabla `clients`; campos nuevos y estados de `service_tickets` |
| 3 | `007_ticket_folio_generation.sql` | Folio `LR-AAAA-NNNNNN` |
| 4 | `008_ticket_events.sql` | Bitácora inmutable `ticket_events` |
| 5 | `009_ticket_rpc_and_rls.sql` | Permisos, RLS y funciones de escritura |

Si Supabase avisa de "operaciones potencialmente destructivas", es por `drop constraint/policy if exists` de objetos propios de este proyecto: puedes confirmar.

**Verificación rápida tras la 009:**
```sql
select service_status, count(*) from public.service_tickets group by 1;
select full_name, role, active from public.profiles order by created_at;
select tablename, rowsecurity from pg_tables where schemaname = 'public';   -- todo en true
```

## 2. Crear el primer administrador

1. *Authentication → Users*: usa un usuario existente o crea uno (*Add user*, *Auto Confirm User*). El trigger de la 005 crea su perfil **inactivo** como técnico.
2. Conviértelo en admin (solo esta vez desde SQL; después lo haces desde el panel):
   ```sql
   select id, email from auth.users;                                   -- copia el UUID
   update public.profiles set role = 'admin', active = true where id = 'UUID_DEL_ADMIN';
   ```
3. Tus usuarios de prueba anteriores conservan su rol; si alguno era `supervisor` ahora es `dispatcher`.

## 3. Desplegar la Edge Function `admin-users` (panel de administración)

La función usa la clave `service_role`, que **Supabase inyecta como secreto del entorno de la función**; nunca va a la PWA ni a GitHub.

**Con el Dashboard:** *Edge Functions → Deploy a new function → Via Editor* → nombre exacto **`admin-users`** → pega el contenido de `supabase/functions/admin-users/index.ts` → **Deploy**. Deja activada la opción *Verify JWT*.

**Con la CLI (opcional):** `supabase login`, `supabase link --project-ref TU_REF`, `supabase functions deploy admin-users`.

No necesitas crear secretos: `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` ya existen dentro de las funciones.

## 4. Crear usuarios y asignar roles

Entra a la PWA como admin → **Usuarios**: crea oficina y técnicos (nombre, correo, contraseña inicial de 10+ caracteres, rol) y cambia rol o activa/desactiva. Un admin no puede degradarse ni desactivarse a sí mismo. Si prefieres SQL, el trigger ya crea el perfil inactivo y solo debes activarlo con el rol correcto:
```sql
update public.profiles set role = 'dispatcher', active = true where id = 'UUID';
```

## 5. Verificar seguridad

Corre `sql/010_test_queries.sql` (con tus UUID) y compara con cada `ESPERADO`. Luego prueba desde la PWA cada rol (ver `docs/ROLES_AND_SECURITY.md`).

## 6. Folios

El primer ticket `LR-` continúa el contador del año (si hay N tickets de prueba, será `LR-AAAA-(N+1)`). Si ya borraste los tickets de prueba y quieres empezar en 000001, ejecuta la línea opcional al final de `007`.

## 7. GitHub

No hay variables nuevas (`VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` siguen igual). Sube el código y el flujo de Actions publica. En los teléfonos que ya tenían la PWA, aparecerá "Hay una versión nueva → Actualizar".
