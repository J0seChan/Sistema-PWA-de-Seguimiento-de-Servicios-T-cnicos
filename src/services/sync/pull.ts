import { getDb } from '../local/db';
import type { RemoteTicket, Ticket } from '../../domain/types';
import type { RemoteRepo } from './engine';

/** Trae los servicios visibles para el usuario. Nunca pisa registros con cambios locales pendientes. */
export async function pullRemote(repo: RemoteRepo, owner: { id: string; name: string }): Promise<number> {
  const remotes = await repo.listTickets();
  const db = await getDb();
  let changed = 0;
  for (const r of remotes) {
    const tx = db.transaction('tickets', 'readwrite');
    const local = await tx.store.get(r.id);
    if (!local) {
      await tx.store.put(fromRemote(r, owner));
      changed++;
    } else if (local.ownerId === owner.id && local.syncStatus === 'synced' && r.version > local.version) {
      await tx.store.put({ ...local, ...r, serverUpdatedAt: r.updated_at, localVersion: local.localVersion + 1 });
      changed++;
    }
    await tx.done;
  }
  return changed;
}

function fromRemote(r: RemoteTicket, owner: { id: string; name: string }): Ticket {
  return {
    ...r,
    ownerId: owner.id,
    technicianName: r.technician_id === owner.id ? owner.name : '',
    syncStatus: 'synced', syncAttempts: 0, lastSyncAttemptAt: null, lastSyncError: null, lastSyncErrorKind: null,
    localUpdatedAt: Date.now(), serverUpdatedAt: r.updated_at, localVersion: 1, conflictRemote: null,
  };
}
