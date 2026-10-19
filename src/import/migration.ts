import { base32Encode } from '../otp/base32';
import type { Algorithm } from '../otp/totp';
import type { NewAccount } from '../storage/accounts';
import { splitLabel } from './otpauth';

/*
 * Google Authenticator export format: otpauth-migration://offline?data=<base64 protobuf>
 *
 * message MigrationPayload {
 *   repeated OtpParameters otp_parameters = 1;
 *   int32 version = 2; int32 batch_size = 3; int32 batch_index = 4; int32 batch_id = 5;
 * }
 * message OtpParameters {
 *   bytes secret = 1; string name = 2; string issuer = 3;
 *   Algorithm algorithm = 4;  // 0 unspecified, 1 SHA1, 2 SHA256, 3 SHA512, 4 MD5
 *   DigitCount digits = 5;    // 0 unspecified, 1 six, 2 eight
 *   OtpType type = 6;         // 0 unspecified, 1 HOTP, 2 TOTP
 *   int64 counter = 7;
 * }
 */

export interface MigrationBatch {
  accounts: NewAccount[];
  batchSize: number;
  batchIndex: number;
  batchId: number;
  skipped: string[]; // names of entries that could not be imported (e.g. MD5)
}

export function isMigrationUri(text: string): boolean {
  return text.trim().toLowerCase().startsWith('otpauth-migration://');
}

export function parseMigrationUri(uri: string): MigrationBatch {
  const match = /[?&]data=([^&]+)/.exec(uri.trim());
  if (!match?.[1]) throw new Error('Migration URI has no data parameter');
  // URLSearchParams would turn '+' into ' ', so decode manually.
  const b64 = decodeURIComponent(match[1]).replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
  return decodePayload(base64ToBytes(b64));
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

class Reader {
  pos = 0;
  constructor(private readonly buf: Uint8Array) {}

  get done(): boolean {
    return this.pos >= this.buf.length;
  }

  varint(): number {
    let result = 0;
    let mul = 1;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.buf.length) throw new Error('Truncated varint');
      const b = this.buf[this.pos++]!;
      result += (b & 0x7f) * mul;
      if ((b & 0x80) === 0) return result;
      mul *= 128;
    }
    throw new Error('Varint too long');
  }

  bytes(): Uint8Array {
    const len = this.varint();
    if (this.pos + len > this.buf.length) throw new Error('Truncated field');
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  skip(wireType: number): void {
    switch (wireType) {
      case 0: this.varint(); break;
      case 1: this.pos += 8; break;
      case 2: this.bytes(); break;
      case 5: this.pos += 4; break;
      default: throw new Error(`Unsupported wire type ${wireType}`);
    }
  }
}

const textDecoder = new TextDecoder();

function decodePayload(buf: Uint8Array): MigrationBatch {
  const r = new Reader(buf);
  const batch: MigrationBatch = { accounts: [], batchSize: 1, batchIndex: 0, batchId: 0, skipped: [] };
  while (!r.done) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (field === 1 && wire === 2) {
      const result = decodeOtpParameters(r.bytes());
      if (typeof result === 'string') batch.skipped.push(result);
      else batch.accounts.push(result);
    } else if (field === 3 && wire === 0) batch.batchSize = r.varint();
    else if (field === 4 && wire === 0) batch.batchIndex = r.varint();
    else if (field === 5 && wire === 0) batch.batchId = r.varint();
    else r.skip(wire);
  }
  return batch;
}

const ALGO: Record<number, Algorithm | undefined> = { 0: 'SHA1', 1: 'SHA1', 2: 'SHA256', 3: 'SHA512' };

/** Returns the account, or the entry's name if it is unsupported. */
function decodeOtpParameters(buf: Uint8Array): NewAccount | string {
  const r = new Reader(buf);
  let secret: Uint8Array = new Uint8Array();
  let name = '';
  let issuer = '';
  let algo = 0;
  let digitCode = 0;
  let typeCode = 0;
  let counter = 0;
  while (!r.done) {
    const tag = r.varint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 2 && field === 1) secret = r.bytes();
    else if (wire === 2 && field === 2) name = textDecoder.decode(r.bytes());
    else if (wire === 2 && field === 3) issuer = textDecoder.decode(r.bytes());
    else if (wire === 0 && field === 4) algo = r.varint();
    else if (wire === 0 && field === 5) digitCode = r.varint();
    else if (wire === 0 && field === 6) typeCode = r.varint();
    else if (wire === 0 && field === 7) counter = r.varint();
    else r.skip(wire);
  }

  const [labelIssuer, account] = splitLabel(name);
  const finalIssuer = issuer || labelIssuer;
  const algorithm = ALGO[algo];
  if (!algorithm || secret.length === 0) return name || '(unnamed)';

  return {
    type: typeCode === 1 ? 'hotp' : 'totp',
    secret: base32Encode(secret),
    issuer: finalIssuer,
    label: account || name,
    algorithm,
    digits: digitCode === 2 ? 8 : 6,
    period: 30,
    counter,
  };
}
