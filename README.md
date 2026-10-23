# Link Redes Servicios

Sistema de tickets para **Link Redes** (Tecnología Salazar Ramos S.A. de C.V.): **oficina** registra clientes y crea/asigna tickets con folio automático (`LR-AAAA-NNNNNN`); el **técnico** los atiende en campo, **sin conexión**, y sincroniza cuando vuelve Internet; todos los técnicos consultan el historial de cualquier cliente; el **admin** gestiona usuarios y roles. Interfaz glassmorphism, tema claro/oscuro automático, acento verde.

> Estado: código completo; probado con un servidor simulado (43 pruebas) y con PostgreSQL local (73 comprobaciones SQL). **Pendiente de validar en tu Supabase real, la Edge Function y Android** (ver `docs/TESTING.md`).

## Inicio rápido

```bash
npm install
cp .env.example .env     # completa URL y clave publicable de TU proyecto Supabase
npm run dev              # desarrollo
npm test                 # pruebas
npm run build            # compila en dist/
```

1. Configura Supabase siguiendo **`docs/SUPABASE_SETUP.md`** (SQL `005`–`009` en `sql/` y Edge Function, se ejecuta a mano).
2. Sube el proyecto a GitHub y despliega con **`docs/DEPLOY.md`**.

## Estructura

| Ruta | Contenido |
|---|---|
| `src/domain` | Tipos, catálogos (tipos/estados en español) y validación |
| `src/services/local` | IndexedDB (`tickets`, `sync_queue`) |
| `src/services/sync` | Motor de sincronización, reintentos, clasificación de errores |
| `src/services/remote` | Cliente y repositorio de Supabase |
| `src/services/auth` | Sesión, perfil y modo sin conexión |
| `src/app` | Vistas (HTML) · `src/main.ts` enrutado y eventos |
| `public/sw.js` | Service Worker (shell offline) |
| `sql/` | Esquema (001-003), fase 2 (005-009) y pruebas manuales (010) |
| `supabase/functions/admin-users` | Edge Function de administración de usuarios |
| `tests/sql` | Pruebas SQL en PostgreSQL local (`run.sh`) |
| `docs/` | Arquitectura, modelo de datos, roles y seguridad, offline y conflictos, pruebas, despliegue |

## Seguridad

Solo `VITE_SUPABASE_URL` y la clave **publicable/anon** van en el cliente. **Nunca** uses `service_role` en este proyecto. La autoridad de permisos es RLS en Supabase.
