import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode } from '../src/otp/base32';
import { type Algorithm, hotp, secondsRemaining, totp } from '../src/otp/totp';

const enc = (s: string) => new TextEncoder().encode(s);

describe('base32', () => {
  it('round-trips and matches RFC 4648 vectors', () => {
    expect(base32Encode(enc('foobar'))).toBe('MZXW6YTBOI');
    expect(new TextDecoder().decode(base32Decode('mzxw 6ytb-oi=='))).toBe('foobar');
  });
  it('rejects invalid characters', () => {
    expect(() => base32Decode('ABC1')).toThrow();
  });
});

describe('HOTP (RFC 4226 Appendix D)', () => {
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  it.each(expected.map((code, i) => [i, code]))('counter %i -> %s', async (counter, code) => {
    expect(await hotp(enc('12345678901234567890'), counter as number)).toBe(code);
  });
});

describe('TOTP (RFC 6238 Appendix B)', () => {
  const keys: Record<Algorithm, Uint8Array<ArrayBuffer>> = {
    SHA1: enc('12345678901234567890'),
    SHA256: enc('12345678901234567890123456789012'),
    SHA512: enc('1234567890123456789012345678901234567890123456789012345678901234'),
  };
  const vectors: [number, string, string, string][] = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ];
  it.each(vectors)('t=%i', async (t, sha1, sha256, sha512) => {
    expect(await totp(keys.SHA1, t * 1000, 30, 8, 'SHA1')).toBe(sha1);
    expect(await totp(keys.SHA256, t * 1000, 30, 8, 'SHA256')).toBe(sha256);
    expect(await totp(keys.SHA512, t * 1000, 30, 8, 'SHA512')).toBe(sha512);
  });

  it('computes seconds remaining', () => {
    expect(secondsRemaining(30, 59_000)).toBe(1);
    expect(secondsRemaining(30, 60_000)).toBe(30);
  });
});
