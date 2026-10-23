import { getDb } from '../local/db';
import { fromRemote } from '../local/tickets';
import type { RemoteRepo } from './engine';

/**
 * Descarga los tickets del técnico (asignados + completados recientes) para trabajar sin conexión.
 * Nunca pisa un ticket con cambios locales pendientes. Los tickets sincronizados que ya no le
 * pertenecen (reasignados) salen del dispositivo; los que tienen cambios pendientes se conservan
 * y el conflicto se presenta al sincronizar.
 */
export async function pullMyTickets(repo: RemoteRepo, ownerId: string): Promise<number> {
  const remotes = await repo.listMyTickets(ownerId);
  const ids = new Set(remotes.map((r) => r.id));
  const db = await getDb();
  let changed = 0;
  for (const r of remotes) {
    const tx = db.transaction('tickets', 'readwrite');
    const local = await tx.store.get(r.id);
    if (!local) { await tx.store.put(fromRemote(r, ownerId)); changed++; }
    else if (local.ownerId === ownerId && !local.hasLocalChanges && !local.conflict && r.version > local.version) {
      await tx.store.put({ ...fromRemote(r, ownerId), localVersion: local.localVersion + 1 }); changed++;
    }
    await tx.done;
  }
  const tx = db.transaction('tickets', 'readwrite');
  for (const t of await tx.store.index('ownerId').getAll(ownerId)) {
    if (!ids.has(t.id) && t.syncStatus === 'synced' && !t.hasLocalChanges && !t.conflict) { await tx.store.delete(t.id); changed++; }
  }
  await tx.done;
  return changed;
}
