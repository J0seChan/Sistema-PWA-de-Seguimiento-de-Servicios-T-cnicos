import { describe, expect, it } from 'vitest';
import { backoffDelay } from '../../src/services/sync/backoff';
import { classifyError, SyncError } from '../../src/services/sync/errors';
import { normalizeInput, validateTicketInput } from '../../src/domain/validation';
import type { TicketInput } from '../../src/domain/types';

const base: TicketInput = {
  service_date: '2026-10-21T10:00:00Z', service_type: 'support', service_status: 'open',
  reported_problem: 'Sin internet', diagnosis: null, action_taken: null, result: null, observations: null, external_ticket_ref: null,
};

describe('backoff', () => {
  it('crece y se limita a 5 min', () => {
    const mid = () => 0.5;
    expect(backoffDelay(1, mid)).toBe(2000);
    expect(backoffDelay(2, mid)).toBe(5000);
    expect(backoffDelay(3, mid)).toBe(15000);
    expect(backoffDelay(99, mid)).toBe(300000);
  });
  it('aplica variación de ±20 %', () => {
    expect(backoffDelay(1, () => 0)).toBe(1600);
    expect(backoffDelay(1, () => 1)).toBe(2400);
  });
});

describe('classifyError', () => {
  it('clasifica los casos principales', () => {
    expect(classifyError(new TypeError('Failed to fetch'), true)).toBe('offline');
    expect(classifyError({ message: 'x' }, false)).toBe('offline');
    expect(classifyError({ status: 401 }, true)).toBe('session');
    expect(classifyError({ message: 'JWT expired' }, true)).toBe('session');
    expect(classifyError({ code: '42501' }, true)).toBe('permission');
    expect(classifyError({ code: '23514' }, true)).toBe('validation');
    expect(classifyError({ status: 503 }, true)).toBe('temporary');
    expect(classifyError(new SyncError('conflict', 'x'), true)).toBe('conflict');
    expect(classifyError({ message: '???' }, true)).toBe('unknown');
  });
});

describe('validación por estado', () => {
  it('abierto solo exige problema reportado', () => {
    expect(validateTicketInput(base)).toEqual({});
    expect(validateTicketInput({ ...base, reported_problem: '  ' }).reported_problem).toBeTruthy();
  });
  it('completado exige diagnóstico, acción y resultado', () => {
    const e = validateTicketInput({ ...base, service_status: 'completed' });
    expect(Object.keys(e).sort()).toEqual(['action_taken', 'diagnosis', 'result']);
  });
  it('limita longitudes y normaliza vacíos a null', () => {
    expect(validateTicketInput({ ...base, observations: 'x'.repeat(2001) }).observations).toBeTruthy();
    expect(normalizeInput({ ...base, diagnosis: '   ', reported_problem: ' hola ' })).toMatchObject({ diagnosis: null, reported_problem: 'hola' });
  });
});
