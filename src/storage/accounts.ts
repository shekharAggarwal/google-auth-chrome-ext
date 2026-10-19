import type { OtpSpec } from '../otp/totp';

export interface Account extends OtpSpec {
  id: string;
  issuer: string;
  label: string;
  createdAt: number;
}

export type NewAccount = Omit<Account, 'id' | 'createdAt'>;

export interface Settings {
  autoLockMinutes: number;
}

export interface VaultData {
  accounts: Account[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = { autoLockMinutes: 5 };

export function emptyVault(): VaultData {
  return { accounts: [], settings: { ...DEFAULT_SETTINGS } };
}

export function createAccount(a: NewAccount): Account {
  return { ...a, secret: normalizeSecret(a.secret), id: crypto.randomUUID(), createdAt: Date.now() };
}

export function normalizeSecret(secret: string): string {
  return secret.toUpperCase().replace(/[\s=-]/g, '');
}

/** True if an account with the same secret already exists. */
export function isDuplicate(existing: Account[], candidate: NewAccount): boolean {
  const s = normalizeSecret(candidate.secret);
  return existing.some((a) => a.secret === s);
}

export function displayName(a: Pick<Account, 'issuer' | 'label'>): string {
  return a.issuer ? `${a.issuer} (${a.label})` : a.label;
}
