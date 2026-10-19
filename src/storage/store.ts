import { b64ToBytes } from '../crypto/encoding';
import { clearSession, getSessionKey, setSessionKey, touch } from '../crypto/session';
import {
  PBKDF2_ITERATIONS,
  type StoredVault,
  WrongPasswordError,
  decryptVault,
  deriveKeyBytes,
  encryptVault,
  randomBytes,
} from '../crypto/vault';
import { type VaultData, emptyVault } from './accounts';

const VAULT = 'vault';
const THROTTLE = 'unlockThrottle';
export const MIN_PASSWORD_LENGTH = 10;

interface Throttle {
  failures: number;
  retryAt: number;
}

async function readStored(): Promise<StoredVault | null> {
  const got = await chrome.storage.local.get(VAULT);
  return (got[VAULT] as StoredVault | undefined) ?? null;
}

async function writeStored(v: StoredVault): Promise<void> {
  await chrome.storage.local.set({ [VAULT]: v });
}

export async function hasVault(): Promise<boolean> {
  return (await readStored()) !== null;
}

export async function createVault(password: string): Promise<VaultData> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  if (await hasVault()) throw new Error('A vault already exists');
  const salt = randomBytes(16);
  const key = await deriveKeyBytes(password, salt);
  const data = emptyVault();
  await writeStored(await encryptVault(data, key, salt));
  await setSessionKey(key);
  await touch(data.settings.autoLockMinutes);
  return data;
}

/** Milliseconds until another unlock attempt is allowed (0 = now). */
export async function unlockWaitMs(): Promise<number> {
  const t = await readThrottle();
  return Math.max(0, t.retryAt - Date.now());
}

async function readThrottle(): Promise<Throttle> {
  const got = await chrome.storage.local.get(THROTTLE);
  return (got[THROTTLE] as Throttle | undefined) ?? { failures: 0, retryAt: 0 };
}

export async function unlock(password: string): Promise<VaultData> {
  const wait = await unlockWaitMs();
  if (wait > 0) throw new Error(`Too many attempts. Try again in ${Math.ceil(wait / 1000)}s`);

  const stored = await readStored();
  if (!stored) throw new Error('No vault yet');
  const key = await deriveKeyBytes(password, b64ToBytes(stored.kdf.salt), stored.kdf.iterations);
  try {
    const data = await decryptVault(stored, key);
    await chrome.storage.local.remove(THROTTLE);
    await setSessionKey(key);
    await touch(data.settings.autoLockMinutes);
    return data;
  } catch (e) {
    if (e instanceof WrongPasswordError) {
      const t = await readThrottle();
      const failures = t.failures + 1;
      // Free retries for typos, then exponential backoff capped at 5 minutes.
      const delayMs = failures < 3 ? 0 : Math.min(300_000, 1000 * 2 ** (failures - 2));
      await chrome.storage.local.set({ [THROTTLE]: { failures, retryAt: Date.now() + delayMs } });
    }
    throw e;
  }
}

/** Returns decrypted data if the session is unlocked, else null. Resets the idle timer. */
export async function loadUnlocked(): Promise<VaultData | null> {
  const key = await getSessionKey();
  const stored = await readStored();
  if (!key || !stored) return null;
  try {
    const data = await decryptVault(stored, key);
    await touch(data.settings.autoLockMinutes);
    return data;
  } catch {
    await clearSession();
    return null;
  }
}

export async function saveVault(data: VaultData): Promise<void> {
  const key = await getSessionKey();
  const stored = await readStored();
  if (!key || !stored) throw new Error('Vault is locked');
  await writeStored(await encryptVault(data, key, b64ToBytes(stored.kdf.salt), stored.kdf.iterations));
  await touch(data.settings.autoLockMinutes);
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  const data = await unlock(oldPassword);
  const salt = randomBytes(16);
  const key = await deriveKeyBytes(newPassword, salt);
  await writeStored(await encryptVault(data, key, salt, PBKDF2_ITERATIONS));
  await setSessionKey(key);
}

export async function lock(): Promise<void> {
  await clearSession();
}
