import { base32Decode } from '../otp/base32';
import type { Algorithm } from '../otp/totp';
import type { NewAccount } from '../storage/accounts';

const ALGORITHMS: readonly Algorithm[] = ['SHA1', 'SHA256', 'SHA512'];

/** Parse a standard `otpauth://totp/...` or `otpauth://hotp/...` URI. */
export function parseOtpauthUri(uri: string): NewAccount {
  const url = new URL(uri.trim());
  if (url.protocol !== 'otpauth:') throw new Error('Not an otpauth:// URI');

  const type = url.hostname.toLowerCase();
  if (type !== 'totp' && type !== 'hotp') throw new Error(`Unsupported OTP type "${type}"`);

  const params = url.searchParams;
  const secret = params.get('secret');
  if (!secret) throw new Error('URI has no secret');
  base32Decode(secret); // validate

  const rawLabel = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const [labelIssuer, labelAccount] = splitLabel(rawLabel);
  const issuer = params.get('issuer') ?? labelIssuer;

  const algorithm = (params.get('algorithm') ?? 'SHA1').toUpperCase() as Algorithm;
  if (!ALGORITHMS.includes(algorithm)) throw new Error(`Unsupported algorithm "${algorithm}"`);

  const digits = Number(params.get('digits') ?? 6);
  if (digits !== 6 && digits !== 8) throw new Error(`Unsupported digit count ${digits}`);

  const period = Number(params.get('period') ?? 30);
  if (!Number.isInteger(period) || period <= 0) throw new Error('Invalid period');

  const counter = Number(params.get('counter') ?? 0);
  if (type === 'hotp' && (!Number.isInteger(counter) || counter < 0)) throw new Error('Invalid counter');

  return { type, secret, issuer, label: labelAccount, algorithm, digits, period, counter };
}

/** Split "Issuer:account" labels; returns [issuer, account]. */
export function splitLabel(label: string): [string, string] {
  const i = label.indexOf(':');
  if (i === -1) return ['', label.trim()];
  return [label.slice(0, i).trim(), label.slice(i + 1).trim()];
}
