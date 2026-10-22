import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SyncOp, Ticket } from '../../domain/types';

interface LRDB extends DBSchema {
  tickets: { key: string; value: Ticket; indexes: { ownerId: string } };
  sync_queue: { key: string; value: SyncOp; indexes: { ticketId: string; ownerId: string } };
}

export type LocalDb = IDBPDatabase<LRDB>;
let dbPromise: Promise<LocalDb> | null = null;
let currentName = 'linkredes_services';

/** Abre (o reabre) la base local. Los tests usan un nombre distinto por prueba. */
export function initDb(name = 'linkredes_services'): Promise<LocalDb> {
  currentName = name;
  dbPromise = openDB<LRDB>(name, 1, {
    upgrade(db) {
      const t = db.createObjectStore('tickets', { keyPath: 'id' });
      t.createIndex('ownerId', 'ownerId');
      const q = db.createObjectStore('sync_queue', { keyPath: 'operationId' });
      q.createIndex('ticketId', 'ticketId', { unique: true }); // una operación vigente por servicio
      q.createIndex('ownerId', 'ownerId');
    },
  });
  return dbPromise;
}

export function getDb(): Promise<LocalDb> {
  return dbPromise ?? initDb(currentName);
}

export async function closeDb(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}
