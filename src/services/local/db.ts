import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SyncOp, Ticket } from '../../domain/types';

interface LRDB extends DBSchema {
  tickets: { key: string; value: Ticket; indexes: { ownerId: string } };
  sync_queue: { key: string; value: SyncOp; indexes: { ticketId: string; ownerId: string } };
}

export type LocalDb = IDBPDatabase<LRDB>;
let dbPromise: Promise<LocalDb> | null = null;
let currentName = 'linkredes_services';
export const DB_VERSION = 2;

/**
 * v1 (fase 1): el técnico creaba sus propios tickets. v2 (fase 2): oficina crea y asigna; el técnico solo atiende.
 * Los registros v1 eran de prueba y tienen otra forma, así que la migración los descarta una sola vez.
 */
export function initDb(name = 'linkredes_services'): Promise<LocalDb> {
  currentName = name;
  dbPromise = openDB<LRDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 2) {
        for (const n of Array.from(db.objectStoreNames)) db.deleteObjectStore(n as 'tickets');
        const t = db.createObjectStore('tickets', { keyPath: 'id' });
        t.createIndex('ownerId', 'ownerId');
        const q = db.createObjectStore('sync_queue', { keyPath: 'operationId' });
        q.createIndex('ticketId', 'ticketId', { unique: true }); // una operación vigente por ticket
        q.createIndex('ownerId', 'ownerId');
      }
    },
  });
  return dbPromise;
}

export function getDb(): Promise<LocalDb> { return dbPromise ?? initDb(currentName); }

export async function closeDb(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}
