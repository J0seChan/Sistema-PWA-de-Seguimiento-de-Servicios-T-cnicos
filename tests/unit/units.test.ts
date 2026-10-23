import { describe, expect, it } from 'vitest';
import { backoffDelay } from '../../src/services/sync/backoff';
import { classifyError, SyncError } from '../../src/services/sync/errors';
import { normalizeAttention, sanitizeSearch, validateAttention, validateNewTicket, type NewTicketForm } from '../../src/domain/validation';
import type { AttentionInput } from '../../src/domain/types';

const att: AttentionInput = { status: 'in_progress', pppoe_confirmed: false, address_confirmed: false, discrepancy_notes: null, diagnosis: null, action_taken: null, result: null, observations: null };
const form: NewTicketForm = { client_id: null, pppoe_username: 'cliente.uno', full_name: '', address: 'Calle 1', address_reference: '', contact_phone: '', service_type: 'support', reported_problem: 'Sin internet', external_ticket_ref: '', technician_id: '' };

describe('backoff', () => {
  it('crece y se limita a 5 min', () => {
    const mid = () => 0.5;
    expect([1, 2, 3, 99].map((n) => backoffDelay(n, mid))).toEqual([2000, 5000, 15000, 300000]);
  });
  it('aplica variación de ±20 %', () => { expect(backoffDelay(1, () => 0)).toBe(1600); expect(backoffDelay(1, () => 1)).toBe(2400); });
});

describe('classifyError', () => {
  it('clasifica los casos principales', () => {
    expect(classifyError(new TypeError('Failed to fetch'), true)).toBe('offline');
    expect(classifyError({ message: 'x' }, false)).toBe('offline');
    expect(classifyError({ status: 401 }, true)).toBe('session');
    expect(classifyError({ message: 'JWT expired' }, true)).toBe('session');
    expect(classifyError({ code: '42501', message: 'forbidden' }, true)).toBe('permission');
    expect(classifyError({ code: 'P0001', message: 'version_conflict' }, true)).toBe('conflict');
    expect(classifyError({ code: '23514' }, true)).toBe('validation');
    expect(classifyError({ status: 503 }, true)).toBe('temporary');
    expect(classifyError(new SyncError('conflict', 'x'), true)).toBe('conflict');
    expect(classifyError({ message: '???' }, true)).toBe('unknown');
  });
});

describe('validación de atención del técnico', () => {
  it('iniciar o guardar avance no exige campos', () => { expect(validateAttention(att)).toEqual({}); });
  it('completar exige diagnóstico, acción, resultado y confirmaciones', () => {
    const e = validateAttention({ ...att, status: 'completed' });
    expect(Object.keys(e).sort()).toEqual(['action_taken', 'diagnosis', 'discrepancy_notes', 'result']);
  });
  it('completar con discrepancia registrada es válido aunque no confirme', () => {
    expect(validateAttention({ ...att, status: 'completed', diagnosis: 'd', action_taken: 'a', result: 'r', discrepancy_notes: 'otra calle' })).toEqual({});
  });
  it('completar con ambas confirmaciones es válido', () => {
    expect(validateAttention({ ...att, status: 'completed', diagnosis: 'd', action_taken: 'a', result: 'r', pppoe_confirmed: true, address_confirmed: true })).toEqual({});
  });
  it('limita longitudes y normaliza vacíos a null', () => {
    expect(validateAttention({ ...att, observations: 'x'.repeat(2001) }).observations).toBeTruthy();
    expect(normalizeAttention({ ...att, diagnosis: '   ', result: ' ok ' })).toMatchObject({ diagnosis: null, result: 'ok' });
  });
});

describe('validación del formulario de oficina', () => {
  it('formulario correcto', () => { expect(validateNewTicket(form)).toEqual({}); });
  it('exige PPPoE, dirección, tipo y problema', () => {
    const e = validateNewTicket({ ...form, pppoe_username: ' ', address: '', service_type: 'x', reported_problem: '' });
    expect(Object.keys(e).sort()).toEqual(['address', 'pppoe_username', 'reported_problem', 'service_type']);
  });
  it('sanitiza búsquedas para filtros PostgREST', () => { expect(sanitizeSearch('a,b(c)*%"\\d')).toBe('a b c d'); expect(sanitizeSearch('  x   y ')).toBe('x y'); });
});
