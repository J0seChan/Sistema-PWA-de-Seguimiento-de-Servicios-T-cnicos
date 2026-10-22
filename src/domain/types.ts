export type ServiceType = 'installation' | 'support' | 'failure' | 'expansion' | 'address_change' | 'modem_change';
export type ServiceStatus = 'open' | 'in_progress' | 'completed';
export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'error';
export type ErrorKind = 'offline' | 'session' | 'permission' | 'validation' | 'conflict' | 'temporary' | 'unknown';
export type Role = 'technician' | 'supervisor' | 'admin';

/** Campos que captura el técnico (y que viajan al servidor). */
export interface TicketInput {
  service_date: string; // ISO
  service_type: ServiceType;
  reported_problem: string;
  diagnosis: string | null;
  action_taken: string | null;
  result: string | null;
  service_status: ServiceStatus;
  observations: string | null;
  external_ticket_ref: string | null;
}

/** Fila tal como existe en Supabase. */
export interface RemoteTicket extends TicketInput {
  id: string;
  folio: string;
  created_by: string;
  technician_id: string;
  created_at: string;
  updated_at: string;
  version: number;
}

/** Registro local: campos del servidor + metadatos de sincronización. */
export interface Ticket extends TicketInput {
  id: string;
  folio: string | null;
  created_by: string;
  technician_id: string;
  created_at: string | null;
  updated_at: string | null;
  version: number; // última versión confirmada por el servidor (0 = nunca sincronizado)
  ownerId: string;
  technicianName: string;
  syncStatus: SyncStatus;
  syncAttempts: number;
  lastSyncAttemptAt: number | null;
  lastSyncError: string | null;
  lastSyncErrorKind: ErrorKind | null;
  localUpdatedAt: number;
  serverUpdatedAt: string | null;
  localVersion: number;
  conflictRemote: RemoteTicket | null;
}

export interface SyncOp {
  operationId: string;
  ticketId: string;
  ownerId: string;
  operationType: 'create' | 'update';
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  payloadVersion: number;
}

export interface AppUser {
  id: string;
  fullName: string;
  role: Role;
  active: boolean;
}
