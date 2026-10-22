import { isServiceStatus, isServiceType } from './catalogs';
import type { TicketInput } from './types';

export const LIMITS = { text: 2000, ref: 100 } as const;
export type FieldErrors = Partial<Record<keyof TicketInput, string>>;

const blank = (v: string | null | undefined) => !v || v.trim() === '';

/**
 * Reglas por estado:
 *  - Siempre: fecha válida, tipo, estado y problema reportado.
 *  - Completado: además diagnóstico, acción realizada y resultado.
 */
export function validateTicketInput(i: TicketInput): FieldErrors {
  const e: FieldErrors = {};
  if (Number.isNaN(Date.parse(i.service_date))) e.service_date = 'Indica una fecha y hora válidas.';
  if (!isServiceType(i.service_type)) e.service_type = 'Selecciona el tipo de servicio.';
  if (!isServiceStatus(i.service_status)) e.service_status = 'Selecciona el estado del servicio.';
  if (blank(i.reported_problem)) e.reported_problem = 'Describe el problema reportado.';
  if (i.service_status === 'completed') {
    if (blank(i.diagnosis)) e.diagnosis = 'Un servicio completado necesita diagnóstico.';
    if (blank(i.action_taken)) e.action_taken = 'Un servicio completado necesita la acción realizada.';
    if (blank(i.result)) e.result = 'Un servicio completado necesita el resultado.';
  }
  for (const k of ['reported_problem', 'diagnosis', 'action_taken', 'result', 'observations'] as const) {
    if ((i[k] ?? '').length > LIMITS.text) e[k] = `Máximo ${LIMITS.text} caracteres.`;
  }
  if ((i.external_ticket_ref ?? '').length > LIMITS.ref) e.external_ticket_ref = `Máximo ${LIMITS.ref} caracteres.`;
  return e;
}

/** Normaliza: recorta espacios y convierte vacíos opcionales a null. */
export function normalizeInput(i: TicketInput): TicketInput {
  const opt = (v: string | null) => (blank(v) ? null : v!.trim());
  return {
    service_date: i.service_date,
    service_type: i.service_type,
    service_status: i.service_status,
    reported_problem: i.reported_problem.trim(),
    diagnosis: opt(i.diagnosis),
    action_taken: opt(i.action_taken),
    result: opt(i.result),
    observations: opt(i.observations),
    external_ticket_ref: opt(i.external_ticket_ref),
  };
}
