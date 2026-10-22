import type { ErrorKind, ServiceStatus, ServiceType, SyncStatus } from './types';

export const SERVICE_TYPES: Record<ServiceType, string> = {
  installation: 'Instalación',
  support: 'Soporte',
  failure: 'Falla',
  expansion: 'Ampliación',
  address_change: 'Cambio de domicilio',
  modem_change: 'Cambio de módem',
};

export const SERVICE_STATUSES: Record<ServiceStatus, string> = {
  open: 'Abierto',
  in_progress: 'En proceso',
  completed: 'Completado',
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
  permission: 'El servidor rechazó la operación por permisos. Avisa a tu administrador.',
  validation: 'El servidor rechazó los datos. Revisa el servicio y corrige los campos.',
  conflict: 'El servicio cambió en el servidor. Revisa las diferencias y decide cómo resolver.',
  temporary: 'Error temporal del servidor. Se reintentará automáticamente.',
  unknown: 'Error inesperado. Puedes reintentar con "Sincronizar ahora".',
};

export const isServiceType = (v: unknown): v is ServiceType => typeof v === 'string' && v in SERVICE_TYPES;
export const isServiceStatus = (v: unknown): v is ServiceStatus => typeof v === 'string' && v in SERVICE_STATUSES;
