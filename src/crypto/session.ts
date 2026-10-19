import { b64ToBytes, bytesToB64 } from './encoding';

// chrome.storage.session is memory-only, cleared on browser restart, and (by default)
// readable only from trusted extension contexts — never from content scripts.
const SESSION_KEY = 'vaultKey';
export const AUTOLOCK_ALARM = 'autolock';

export async function setSessionKey(keyBytes: Uint8Array): Promise<void> {
  await chrome.storage.session.set({ [SESSION_KEY]: bytesToB64(keyBytes) });
}

export async function getSessionKey(): Promise<Uint8Array<ArrayBuffer> | null> {
  const got = await chrome.storage.session.get(SESSION_KEY);
  const v = got[SESSION_KEY];
  return typeof v === 'string' ? b64ToBytes(v) : null;
}

export async function clearSession(): Promise<void> {
  await chrome.storage.session.remove(SESSION_KEY);
  await chrome.alarms.clear(AUTOLOCK_ALARM);
}

/** Restart the idle auto-lock timer. */
export async function touch(autoLockMinutes: number): Promise<void> {
  await chrome.alarms.create(AUTOLOCK_ALARM, { delayInMinutes: Math.max(1, autoLockMinutes) });
}
