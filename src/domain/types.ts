export type ServiceType = 'installation' | 'support' | 'failure' | 'expansion' | 'address_change' | 'modem_change';
/** Estado OPERATIVO del ticket (independiente del estado de sincronización). */
export type TicketStatus = 'unassigned' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';
export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'error';
export type ErrorKind = 'offline' | 'session' | 'permission' | 'validation' | 'conflict' | 'temporary' | 'unknown';
export type ConflictReason = 'version' | 'reassigned' | 'closed';
export type Role = 'technician' | 'dispatcher' | 'admin';

export interface Client {
  id: string;
  pppoe_username: string;
  full_name: string | null;
  address: string;
  address_reference: string | null;
  contact_phone: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

/** Fila de public.service_tickets tal como la confirma el servidor. */
export interface RemoteTicket {
  id: string;
  folio: string;
  created_by: string;
  technician_id: string | null;
  technician_name: string | null;
  client_id: string | null;
  client_pppoe_snapshot: string | null;
  client_name_snapshot: string | null;
  client_address_snapshot: string | null;
  client_reference_snapshot: string | null;
  external_ticket_ref: string | null;
  service_date: string;
  service_type: ServiceType;
  reported_problem: string;
  diagnosis: string | null;
  action_taken: string | null;
  result: string | null;
  service_status: TicketStatus;
  observations: string | null;
  pppoe_confirmed: boolean;
  address_confirmed: boolean;
  discrepancy_notes: string | null;
  assigned_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  last_operation_id: string | null;
}

/** Lo único que el técnico puede registrar (campos de atención). */
export interface AttentionInput {
  status: 'in_progress' | 'completed';
  pppoe_confirmed: boolean;
  address_confirmed: boolean;
  discrepancy_notes: string | null;
  diagnosis: string | null;
  action_taken: string | null;
  result: string | null;
  observations: string | null;
}

export interface Conflict { reason: ConflictReason; remote: RemoteTicket | null }

/** Ticket en el dispositivo del técnico: copia del servidor + cambios locales + metadatos de sync. */
export interface Ticket extends RemoteTicket {
  ownerId: string;
  syncStatus: SyncStatus;
  syncAttempts: number;
  lastSyncAttemptAt: number | null;
  lastSyncError: string | null;
  lastSyncErrorKind: ErrorKind | null;
  localUpdatedAt: number;
  serverUpdatedAt: string | null;
  localVersion: number;
  hasLocalChanges: boolean;
  conflict: Conflict | null;
}

export interface SyncOp {
  operationId: string;
  ticketId: string;
  ownerId: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  payloadVersion: number;
  /** Id enviado al servidor en el último intento y versión local que se envió (para detectar "se aplicó pero la respuesta se perdió"). */
  attemptOperationId: string | null;
  attemptLocalVersion: number | null;
}

export interface AppUser {
  id: string;
  fullName: string;
  role: Role;
  active: boolean;
}

export interface Technician { id: string; full_name: string }
export interface UserRow { id: string; full_name: string; role: Role; active: boolean }
