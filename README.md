# Link Redes Servicios

PWA para que los técnicos de **Link Redes** (Tecnología Salazar Ramos S.A. de C.V.) documenten servicios técnicos en campo, **sin conexión**, y los sincronicen con Supabase cuando vuelva Internet. Interfaz glassmorphism, tema claro/oscuro automático, acento verde.

> Estado: código completo y probado con un servidor simulado. **No** está desplegado ni probado contra tu Supabase real (ver `docs/TESTING.md`).

## Inicio rápido

```bash
npm install
cp .env.example .env     # completa URL y clave publicable de TU proyecto Supabase
npm run dev              # desarrollo
npm test                 # pruebas
npm run build            # compila en dist/
```

1. Configura Supabase siguiendo **`docs/SUPABASE_SETUP.md`** (SQL en `sql/`, se ejecuta a mano).
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
| `sql/` | Esquema, funciones/triggers, RLS y pruebas manuales |
| `docs/` | Arquitectura, modelo de datos, sincronización, pruebas, despliegue |

## Seguridad

Solo `VITE_SUPABASE_URL` y la clave **publicable/anon** van en el cliente. **Nunca** uses `service_role` en este proyecto. La autoridad de permisos es RLS en Supabase.
