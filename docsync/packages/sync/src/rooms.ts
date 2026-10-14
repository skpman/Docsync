import { Room } from './room.js';

const rooms = new Map<string, Promise<Room>>();
const closing = new Map<string, Promise<void>>();

/** Returns the live room for a document, loading it from Postgres on first use. */
export async function getRoom(documentId: string): Promise<Room> {
  // If the room is being torn down, wait so we reload the saved state instead of racing it
  await closing.get(documentId);
  let pending = rooms.get(documentId);
  if (!pending) {
    pending = (async () => {
      const room = new Room(documentId, scheduleClose);
      await room.load();
      return room;
    })();
    rooms.set(documentId, pending);
    pending.catch(() => rooms.delete(documentId));
  }
  return pending;
}

export function peekRoom(documentId: string): Promise<Room> | undefined {
  return rooms.get(documentId);
}

/** Runs `fn` with the room held open, then lets it close if nobody else is using it. */
export async function withRoom<T>(documentId: string, fn: (room: Room) => Promise<T>): Promise<T> {
  const room = await getRoom(documentId);
  const release = room.lease();
  try {
    return await fn(room);
  } finally {
    release();
  }
}

function scheduleClose(room: Room) {
  // Short grace period so a quick reconnect (page reload, network blip) reuses the room
  setTimeout(() => {
    if (room.refCount > 0 || closing.has(room.id)) return;
    rooms.delete(room.id);
    const done = room.close().finally(() => closing.delete(room.id));
    closing.set(room.id, done);
  }, 5000);
}

export async function discardRoom(documentId: string) {
  const pending = rooms.get(documentId);
  rooms.delete(documentId);
  if (pending) (await pending).discard(4404, 'Document deleted');
}

export async function closeAllRooms() {
  const all = await Promise.all(rooms.values());
  rooms.clear();
  await Promise.all(all.map((r) => r.close()));
  await Promise.all(closing.values());
}
