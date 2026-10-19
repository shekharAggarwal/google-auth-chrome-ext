import type { NewAccount } from '../storage/accounts';
import { isMigrationUri, parseMigrationUri } from './migration';
import { parseOtpauthUri } from './otpauth';

export interface ParsedImport {
  accounts: NewAccount[];
  skipped: string[];
  batch?: { index: number; size: number; id: number };
}

/** Parse any supported QR/URI payload into accounts. */
export function parseImportText(text: string): ParsedImport {
  const t = text.trim();
  if (isMigrationUri(t)) {
    const b = parseMigrationUri(t);
    return { accounts: b.accounts, skipped: b.skipped, batch: { index: b.batchIndex, size: b.batchSize, id: b.batchId } };
  }
  if (t.toLowerCase().startsWith('otpauth://')) return { accounts: [parseOtpauthUri(t)], skipped: [] };
  throw new Error('Not an authenticator QR code (expected otpauth:// or otpauth-migration://)');
}
