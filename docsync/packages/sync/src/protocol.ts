import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

// Message types of the y-websocket wire protocol (compatible with the y-websocket client provider)
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_AUTH = 2;
export const MESSAGE_QUERY_AWARENESS = 3;

// Sync sub-message types from y-protocols/sync
export const SYNC_STEP1 = 0;
export const SYNC_STEP2 = 1;
export const SYNC_UPDATE = 2;

/** Name of the Y.XmlFragment that TipTap's Collaboration extension binds to. */
export const EDITOR_FIELD = 'default';

export interface VerifiedUser {
  id: string;
  name: string;
  color: string;
}

/**
 * Rewrites an awareness update so every state's `user` field carries the identity from the
 * connection's verified JWT. Clients can't impersonate someone else in cursors or presence.
 */
export function stampAwarenessIdentity(update: Uint8Array, user: VerifiedUser): Uint8Array {
  const decoder = decoding.createDecoder(update);
  const encoder = encoding.createEncoder();
  const len = decoding.readVarUint(decoder);
  encoding.writeVarUint(encoder, len);
  for (let i = 0; i < len; i++) {
    const clientId = decoding.readVarUint(decoder);
    const clock = decoding.readVarUint(decoder);
    const raw = decoding.readVarString(decoder);
    let state = JSON.parse(raw);
    if (state !== null && typeof state === 'object') {
      state = { ...state, user: { ...(state.user ?? {}), ...user } };
    }
    encoding.writeVarUint(encoder, clientId);
    encoding.writeVarUint(encoder, clock);
    encoding.writeVarString(encoder, JSON.stringify(state));
  }
  return encoding.toUint8Array(encoder);
}
