import type { ErrorKind, Role, ServiceType, SyncStatus, TicketStatus } from './types';

export const SERVICE_TYPES: Record<ServiceType, string> = {
  installation: 'Instalación',
  support: 'Soporte',
  failure: 'Falla',
  expansion: 'Ampliación',
  address_change: 'Cambio de domicilio',
  modem_change: 'Cambio de módem',
};

export const TICKET_STATUSES: Record<TicketStatus, string> = {
  unassigned: 'Pendiente de asignación',
  assigned: 'Asignado',
  in_progress: 'En proceso',
  completed: 'Completado',
  cancelled: 'Cancelado',
};

export const ROLE_LABELS: Record<Role, string> = {
  technician: 'Técnico',
  dispatcher: 'Oficina',
  admin: 'Administrador',
};

export const SYNC_LABELS: Record<SyncStatus, string> = {
  pending: '● Pendiente de sincronizar',
  syncing: '⟳ Sincronizando',
  synced: '✓ Confirmado en el servidor',
  error: '⚠ Requiere atención',
};

export const ERROR_MESSAGES: Record<ErrorKind, string> = {
  offline: 'Sin conexión. Se reintentará automáticamente.',
  session: 'Tu sesión expiró. Inicia sesión para continuar; tus datos siguen guardados.',
  permission: 'El servidor rechazó la operación por permisos. Avisa a oficina o a tu administrador.',
  validation: 'El servidor rechazó los datos. Revisa el servicio y corrige los campos.',
  conflict: 'El ticket cambió en el servidor. Revisa y decide cómo resolver.',
  temporary: 'Error temporal del servidor. Se reintentará automáticamente.',
  unknown: 'Error inesperado. Puedes reintentar con "Sincronizar ahora".',
};

export const isServiceType = (v: unknown): v is ServiceType => typeof v === 'string' && v in SERVICE_TYPES;
export const isOffice = (r: Role | undefined) => r === 'dispatcher' || r === 'admin';
