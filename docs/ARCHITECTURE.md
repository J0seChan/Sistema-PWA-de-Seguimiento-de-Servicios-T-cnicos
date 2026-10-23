# Arquitectura

Vite + TypeScript sin framework. Dependencias de producción: `@supabase/supabase-js` e `idb`.

```
UI (app/views*.ts, main.ts)
 ├─ técnico:  services/local (IndexedDB) → services/sync (cola, reintentos) → services/remote/repository (RPC save_ticket_attention)
 ├─ oficina/admin: services/remote/office.ts (en línea: RPC + consultas paginadas) 
 ├─ services/auth: sesión, perfil, identidad conocida offline
 └─ supabase/functions/admin-users: Edge Function (única que usa service_role)
PostgreSQL: tablas + RLS + funciones SECURITY DEFINER (escritura) + triggers + bitácora
```
- La seguridad vive en PostgreSQL; la interfaz solo oculta opciones por comodidad.
- El motor de sincronización depende de la interfaz `RemoteRepo` (probado con servidor simulado).
- Rutas por hash (`#/ticket/<id>`, `#/view/<id>`, `#/client/<id>`…) por compatibilidad con GitHub Pages. Rutas de oficina (`#/new`, `#/tickets`, `#/users`) las atiende un rol de oficina/admin; un técnico que las escriba vuelve al inicio, y aunque llegara, el servidor rechaza sus operaciones.
- Service Worker: precachea el shell; nunca cachea respuestas de Supabase.
