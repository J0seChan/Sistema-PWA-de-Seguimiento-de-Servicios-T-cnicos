# Roles, permisos y seguridad

## Roles
| Rol | Quién | Puede |
|---|---|---|
| `dispatcher` | Oficina (antes `supervisor`, unificado) | Crear/editar clientes, crear tickets, asignar/reasignar, editar datos de oficina, cancelar/reabrir, ver todos los tickets, clientes y bitácora |
| `technician` | Técnico de campo | Ver **sus** tickets y el historial de tickets **completados**; registrar atención en sus tickets; ver clientes |
| `admin` | Administrador | Todo lo de oficina + gestionar usuarios y roles (por Edge Function) |

`supervisor` no se conserva como rol independiente (decisión del propietario): la migración 005 lo convierte en `dispatcher`. Ningún usuario recibe privilegios automáticamente: los perfiles nuevos nacen **inactivos** como técnico.

## Matriz (aplicada en PostgreSQL, no solo en la interfaz)
| Acción | technician | dispatcher | admin | anon |
|---|---|---|---|---|
| Insertar/actualizar/borrar `service_tickets` directo | ✗ | ✗ | ✗ | ✗ |
| `create_ticket`, `assign_ticket`, `update_ticket_office`, `cancel_ticket`, `reopen_ticket` | ✗ | ✓ | ✓ | ✗ |
| `save_ticket_attention` | ✓ solo el asignado | ✗ | ✗ | ✗ |
| Leer tickets | propios (todo estado) + completados de cualquiera | todos | todos | ✗ |
| Leer/crear/editar clientes | leer | leer/crear/editar | leer/crear/editar | ✗ |
| Leer `ticket_events` | los de sus tickets | todos | todos | ✗ |
| Cambiar `role`/`active` | ✗ (sin permiso de columna) | ✗ | solo vía Edge Function | ✗ |
| Folio, cliente, snapshots, creador | inmutables para todos (trigger) | | | |

Un usuario **inactivo** no lee ni escribe nada (todas las políticas y funciones consultan `current_role_if_active()`).

## Decisiones de diseño y supuestos
- **Escritura solo por funciones**: el cliente no tiene `INSERT/UPDATE` sobre tickets. Cada función valida rol, asignación, versión y estado en el servidor. Un trigger rechaza además escrituras directas de usuarios con sesión (defensa en profundidad).
- **`SECURITY DEFINER`**: es necesario porque las funciones escriben en tablas sin permiso directo y en la bitácora. Todas fijan `search_path = public`, validan `auth.uid()`/rol al inicio, y están revocadas a `PUBLIC` y `anon`. `next_folio()` y los triggers definer no son ejecutables por clientes. Se listan con la consulta final de `sql/010_test_queries.sql`.
- **Historial global (supuesto)**: los técnicos ven tickets *completados* de cualquiera y los *propios*; no ven tickets abiertos/sin asignar/cancelados ajenos (menor exposición de datos). Para abrirlo a todos los estados cambia `tickets_select_technician` en `009`.
- **Nombre del técnico en el ticket** (`technician_name`): copia al asignar, para no dar acceso a perfiles ajenos. Puede quedar desfasada si el técnico cambia de nombre.
- **PPPoE y dirección originales** se copian al ticket (snapshot inmutable). Si oficina corrige al cliente, los tickets antiguos conservan lo que se capturó; el técnico registra diferencias en `discrepancy_notes` sin sobrescribir nada.
- **No se almacenan contraseñas PPPoE** ni credenciales de servicio.
- `service_role` solo existe dentro de la Edge Function; verifica el JWT y el rol admin **en el servidor** antes de actuar.

## Cómo probar cada rol desde la PWA
1. **Admin**: entra → Usuarios → crea un `dispatcher` y dos `technician`.
2. **Oficina** (dispatcher): Nuevo → busca/crea cliente → tipo, problema → asigna técnico → "Crear ticket". Comprueba que el folio sea `LR-AAAA-NNNNNN`. En el detalle prueba reasignar, editar y cancelar/reabrir.
3. **Técnico A**: Mis tickets → Sincronizar ahora → abre el ticket → confirma PPPoE/dirección → Iniciar atención → Completar. Prueba modo avión: captura, vuelve la conexión y sincroniza.
4. **Técnico B**: Historial de clientes → busca el PPPoE → ve el ticket completado de A; no ve los abiertos de A.
5. **Seguridad**: con la cuenta técnico intenta abrir `#/new` o `#/users` (debe volver al inicio) — y recuerda que la barrera real es RLS (`sql/010_test_queries.sql`).

## Usuarios con historial no se borran
`created_by`, `technician_id` y `ticket_events.actor_id` apuntan a `profiles`. Un usuario que ya creó, atendió o tocó tickets **no se puede eliminar** de Authentication (la base lo impide para conservar el historial). Para dejar de usarlo, **desactívalo** (panel de admin o `update public.profiles set active = false …`).
