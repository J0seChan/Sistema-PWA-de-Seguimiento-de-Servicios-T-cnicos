# Configuración manual de Supabase

Todo esto lo haces tú; la app y estos archivos **no** ejecutan nada contra Supabase por su cuenta. Usa un proyecto **nuevo e independiente de Monitor ISP**.

1. **Crear el proyecto** en supabase.com (región cercana a México). Guarda la contraseña de la base de datos en un gestor de contraseñas, no en el repo.
2. **Obtener credenciales**: *Project Settings → API*: copia la **Project URL** y la clave **publicable** (o `anon` en proyectos con claves heredadas; son equivalentes para el cliente). **No** copies `service_role`.
3. **Variables locales**: `cp .env.example .env` y pega ambos valores en `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
4. **Desactivar el registro público**: *Authentication → Sign In / Providers → Email*: desactiva *Allow new users to sign up*. Los usuarios los creas tú.
5. **Ejecutar el SQL**, en este orden, desde *SQL Editor* (léelo antes; es idempotente y no destructivo):
   1. `sql/001_schema.sql` — tablas y restricciones
   2. `sql/002_functions_and_triggers.sql` — folios `SRV-AAAA-NNNNNN`, versión, protección de campos
   3. `sql/003_rls_policies.sql` — RLS y permisos
6. **Verificar RLS**: *Table Editor* debe mostrar `RLS enabled` en `profiles`, `folio_counters` y `service_tickets`.
7. **Crear usuarios de prueba**: *Authentication → Users → Add user* (marca *Auto Confirm User*). Crea al menos **dos técnicos** (A y B) y copia sus UUID.
8. **Crear perfiles y roles** (SQL Editor; sin sesión de usuario, esto es el "procedimiento administrativo autorizado"):
   ```sql
   insert into public.profiles (id, full_name, role) values
     ('UUID_TECNICO_A', 'Técnico A', 'technician'),
     ('UUID_TECNICO_B', 'Técnico B', 'technician');
   -- Primer administrador (opcional):
   -- insert into public.profiles (id, full_name, role) values ('UUID_ADMIN', 'Admin', 'admin');
   ```
9. **Probar con una cuenta técnica**: inicia sesión en la PWA, crea un servicio, sincroniza y revisa que aparezca con folio en `service_tickets`.
10. **Probar aislamiento**: ejecuta los bloques de `sql/004_test_queries.sql` (cada uno termina en `ROLLBACK`) y compara con el resultado `ESPERADO` de cada uno.
11. **Errores esperados sin permisos**: sin sesión, `anon` recibe `permission denied`; un técnico no ve ni modifica servicios ajenos.
12. **URL de producción**: cuando despliegues, en *Authentication → URL Configuration* agrega la URL de GitHub Pages (`https://USUARIO.github.io/REPO/`) como *Site URL*.

## Desactivar o cambiar el rol de un usuario (solo desde SQL Editor)

```sql
update public.profiles set active = false where id = 'UUID';        -- bloquea nuevas operaciones remotas
update public.profiles set role = 'supervisor' where id = 'UUID';
```

## Notas

- Folio: `SRV-` + año (hora de Ciudad de México) + consecutivo de 6 dígitos, con contador atómico en `folio_counters`.
- `supervisor` y `admin` pueden **leer** todos los servicios; no hay panel en el MVP.
- No hay política `DELETE`: los servicios no se borran físicamente.
