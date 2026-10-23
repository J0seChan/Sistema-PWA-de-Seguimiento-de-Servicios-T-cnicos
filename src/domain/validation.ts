import { isServiceType } from './catalogs';
import type { AttentionInput } from './types';

export const LIMITS = { text: 2000, ref: 100, pppoe: 100, name: 150, address: 300, phone: 30 } as const;
const blank = (v: string | null | undefined) => !v || v.trim() === '';
const opt = (v: string | null | undefined) => (blank(v) ? null : v!.trim());

export type AttentionErrors = Partial<Record<keyof AttentionInput, string>>;

/** Atención del técnico. Completar exige diagnóstico, acción, resultado y confirmaciones (o discrepancia registrada). */
export function validateAttention(i: AttentionInput): AttentionErrors {
  const e: AttentionErrors = {};
  for (const k of ['diagnosis', 'action_taken', 'result', 'observations', 'discrepancy_notes'] as const) {
    if ((i[k] ?? '').length > LIMITS.text) e[k] = `Máximo ${LIMITS.text} caracteres.`;
  }
  if (i.status === 'completed') {
    if (blank(i.diagnosis)) e.diagnosis = 'Para completar se necesita el diagnóstico real.';
    if (blank(i.action_taken)) e.action_taken = 'Para completar se necesita la acción realizada.';
    if (blank(i.result)) e.result = 'Para completar se necesita el resultado.';
    if (!(i.pppoe_confirmed && i.address_confirmed) && blank(i.discrepancy_notes)) {
      e.discrepancy_notes = 'Confirma PPPoE y dirección, o describe la diferencia encontrada.';
    }
  }
  return e;
}

export function normalizeAttention(i: AttentionInput): AttentionInput {
  return {
    status: i.status, pppoe_confirmed: !!i.pppoe_confirmed, address_confirmed: !!i.address_confirmed,
    discrepancy_notes: opt(i.discrepancy_notes), diagnosis: opt(i.diagnosis), action_taken: opt(i.action_taken),
    result: opt(i.result), observations: opt(i.observations),
  };
}

export interface NewTicketForm {
  client_id: string | null;
  pppoe_username: string; full_name: string; address: string; address_reference: string; contact_phone: string;
  service_type: string; reported_problem: string; external_ticket_ref: string; technician_id: string;
}
export type NewTicketErrors = Partial<Record<keyof NewTicketForm, string>>;

/** Formulario de oficina: cliente (existente o nuevo) + problema reportado. */
export function validateNewTicket(f: NewTicketForm): NewTicketErrors {
  const e: NewTicketErrors = {};
  if (blank(f.pppoe_username)) e.pppoe_username = 'Indica el usuario PPPoE.';
  else if (f.pppoe_username.trim().length > LIMITS.pppoe) e.pppoe_username = `Máximo ${LIMITS.pppoe} caracteres.`;
  if (blank(f.address)) e.address = 'Indica la dirección del cliente.';
  else if (f.address.length > LIMITS.address) e.address = `Máximo ${LIMITS.address} caracteres.`;
  if (f.full_name.length > LIMITS.name) e.full_name = `Máximo ${LIMITS.name} caracteres.`;
  if (f.address_reference.length > LIMITS.address) e.address_reference = `Máximo ${LIMITS.address} caracteres.`;
  if (f.contact_phone.length > LIMITS.phone) e.contact_phone = `Máximo ${LIMITS.phone} caracteres.`;
  if (!isServiceType(f.service_type)) e.service_type = 'Selecciona el tipo de servicio.';
  if (blank(f.reported_problem)) e.reported_problem = 'Describe el problema reportado.';
  else if (f.reported_problem.length > LIMITS.text) e.reported_problem = `Máximo ${LIMITS.text} caracteres.`;
  if (f.external_ticket_ref.length > LIMITS.ref) e.external_ticket_ref = `Máximo ${LIMITS.ref} caracteres.`;
  return e;
}

/** Quita caracteres que rompen los filtros de PostgREST (.or / ilike). */
export const sanitizeSearch = (q: string) => q.replace(/[,()*%\\"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
