# Arquitectura

Vite + TypeScript sin framework, HTML/CSS propios. Dependencias en producción: `@supabase/supabase-js` e `idb` (envoltorio mínimo de IndexedDB). No se agregaron más.

```
UI (views.ts, main.ts)
   │ usa
   ├─ services/local   → IndexedDB: guardado inmediato, cola persistente
   ├─ services/sync    → motor: cola → repositorio remoto → confirma → actualiza local
   ├─ services/remote  → Supabase (único lugar con consultas remotas)
   └─ services/auth    → sesión, perfil, identidad conocida offline
```

- **Guardar siempre es local primero** (transacción única ticket + operación en cola); luego se intenta sincronizar.
- El motor depende de la interfaz `RemoteRepo`, por eso se prueba con un servidor simulado.
- **Offline**: el Service Worker precachea el shell (lista generada en el build). Solo atiende el mismo origen; nunca cachea respuestas de Supabase.
- **Sesión offline**: se guarda en `localStorage` solo la identidad conocida (id, nombre, rol) para abrir los datos locales. No hay contraseñas guardadas ni autenticación offline. Riesgo: quien tenga el teléfono desbloqueado puede ver los servicios del último usuario hasta que cierre sesión.
- **Cambio de usuario**: cada registro y operación lleva `ownerId`; las pantallas y el motor solo ven los del usuario actual. Cerrar sesión no borra datos pendientes.
- **Enrutado por hash** (`#/history`, `#/ticket/<id>`) por compatibilidad con GitHub Pages.

## Decisiones tomadas

- Obligatoriedad por estado: siempre fecha, tipo, estado y problema; si está *Completado*, también diagnóstico, acción y resultado (también lo exige la base de datos).
- El payload no se copia a la cola: la operación apunta al servicio y se envía su última versión (editar un pendiente nunca duplica).
- Folio `SRV-AAAA-NNNNNN` con año en hora de Ciudad de México.
- Cierre de sesión con pendientes: pide confirmación y conserva los datos.
