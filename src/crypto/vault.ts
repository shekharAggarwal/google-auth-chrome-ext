import type { VaultData } from '../storage/accounts';
import { b64ToBytes, bytesToB64 } from './encoding';

export const PBKDF2_ITERATIONS = 600_000;
const FORMAT_VERSION = 1;
const AAD = new TextEncoder().encode('private-authenticator/vault/v1');

/** What is persisted in chrome.storage.local. Never contains plaintext secrets. */
export interface StoredVault {
  v: number;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  iv: string;
  ct: string;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Derive 32 raw key bytes from the master password. */
export async function deriveKeyBytes(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations = PBKDF2_ITERATIONS,
): Promise<Uint8Array<ArrayBuffer>> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256);
  return new Uint8Array(bits);
}

function importAesKey(keyBytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptVault(
  data: VaultData,
  keyBytes: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  iterations = PBKDF2_ITERATIONS,
): Promise<StoredVault> {
  const iv = randomBytes(12);
  const key = await importAesKey(keyBytes);
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, plaintext);
  return {
    v: FORMAT_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: bytesToB64(salt) },
    iv: bytesToB64(iv),
    ct: bytesToB64(new Uint8Array(ct)),
  };
}

/** Throws WrongPasswordError if the key does not authenticate the ciphertext. */
export async function decryptVault(stored: StoredVault, keyBytes: Uint8Array<ArrayBuffer>): Promise<VaultData> {
  if (stored.v !== FORMAT_VERSION) throw new Error(`Unsupported vault version ${stored.v}`);
  const key = await importAesKey(keyBytes);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(stored.iv), additionalData: AAD },
      key,
      b64ToBytes(stored.ct),
    );
  } catch {
    throw new WrongPasswordError();
  }
  return JSON.parse(new TextDecoder().decode(plaintext)) as VaultData;
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong password');
    this.name = 'WrongPasswordError';
  }
}
