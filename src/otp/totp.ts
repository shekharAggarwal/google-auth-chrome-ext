import { base32Decode } from './base32';

export type Algorithm = 'SHA1' | 'SHA256' | 'SHA512';

const HASH: Record<Algorithm, string> = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };

/** RFC 4226 HOTP. `key` is the raw secret bytes. */
export async function hotp(key: Uint8Array<ArrayBuffer>, counter: number, digits = 6, algorithm: Algorithm = 'SHA1'): Promise<string> {
  const msg = new Uint8Array(8);
  const view = new DataView(msg.buffer);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);

  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: HASH[algorithm] }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, msg));

  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/** RFC 6238 TOTP. */
export async function totp(
  key: Uint8Array<ArrayBuffer>,
  timeMs = Date.now(),
  period = 30,
  digits = 6,
  algorithm: Algorithm = 'SHA1',
): Promise<string> {
  return hotp(key, Math.floor(timeMs / 1000 / period), digits, algorithm);
}

export interface OtpSpec {
  type: 'totp' | 'hotp';
  secret: string; // base32
  algorithm: Algorithm;
  digits: number;
  period: number;
  counter: number;
}

export async function generateCode(spec: OtpSpec, timeMs = Date.now()): Promise<string> {
  const key = base32Decode(spec.secret);
  return spec.type === 'hotp'
    ? hotp(key, spec.counter, spec.digits, spec.algorithm)
    : totp(key, timeMs, spec.period, spec.digits, spec.algorithm);
}

/** Seconds left in the current TOTP window. */
export function secondsRemaining(period: number, timeMs = Date.now()): number {
  return period - (Math.floor(timeMs / 1000) % period);
}
