import { describe, expect, it } from 'vitest';
import { parseImportText } from '../src/import';
import { parseMigrationUri } from '../src/import/migration';
import { parseOtpauthUri } from '../src/import/otpauth';
import { base32Encode } from '../src/otp/base32';

describe('otpauth URI', () => {
  it('parses a full TOTP URI', () => {
    const a = parseOtpauthUri(
      'otpauth://totp/ACME%20Co:john.doe@email.com?secret=HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60',
    );
    expect(a).toMatchObject({
      type: 'totp', issuer: 'ACME Co', label: 'john.doe@email.com',
      algorithm: 'SHA256', digits: 8, period: 60,
    });
  });
  it('applies defaults and label issuer', () => {
    const a = parseOtpauthUri('otpauth://totp/GitHub:me?secret=JBSWY3DPEHPK3PXP');
    expect(a).toMatchObject({ issuer: 'GitHub', label: 'me', algorithm: 'SHA1', digits: 6, period: 30 });
  });
  it('rejects bad input', () => {
    expect(() => parseOtpauthUri('otpauth://totp/x?secret=')).toThrow();
    expect(() => parseOtpauthUri('otpauth://totp/x?secret=JBSWY3DP&digits=7')).toThrow();
    expect(() => parseOtpauthUri('https://example.com')).toThrow();
  });
});

// Minimal protobuf writer for building fixtures.
function varint(n: number): number[] {
  const out: number[] = [];
  while (n > 127) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  out.push(n);
  return out;
}
const field = (num: number, bytes: number[]) => [...varint((num << 3) | 2), ...varint(bytes.length), ...bytes];
const intField = (num: number, v: number) => [...varint(num << 3), ...varint(v)];
const str = (s: string) => [...new TextEncoder().encode(s)];
const toUri = (bytes: number[]) =>
  'otpauth-migration://offline?data=' + encodeURIComponent(btoa(String.fromCharCode(...bytes)));

describe('Google Authenticator migration', () => {
  it('decodes a known export payload', () => {
    const b = parseMigrationUri(
      'otpauth-migration://offline?data=CjEKCkhlbGxvId6tvu8SGEV4YW1wbGU6YWxpY2VAZ29vZ2xlLmNvbRoHRXhhbXBsZTAC',
    );
    expect(b.accounts).toHaveLength(1);
    expect(b.accounts[0]).toMatchObject({
      type: 'totp', issuer: 'Example', label: 'alice@google.com',
      secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6,
    });
  });

  it('decodes multiple accounts, algorithms, HOTP and batch info; skips MD5', () => {
    const secret = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const otp = (name: string, issuer: string, algo: number, digits: number, type: number, counter = 0) =>
      field(1, [...field(1, secret), ...field(2, str(name)), ...field(3, str(issuer)),
        ...intField(4, algo), ...intField(5, digits), ...intField(6, type), ...intField(7, counter)]);
    const payload = [
      ...otp('a@x.com', 'Alpha', 2, 2, 2),
      ...otp('Beta:b@x.com', '', 1, 1, 1, 42),
      ...otp('bad', 'Old', 4, 1, 2),
      ...intField(2, 1), ...intField(3, 2), ...intField(4, 1), ...intField(5, 777),
    ];
    // Ensure '+' characters survive URI handling.
    const b = parseMigrationUri(toUri(payload));
    expect(b.accounts).toEqual([
      { type: 'totp', secret: base32Encode(new Uint8Array(secret)), issuer: 'Alpha', label: 'a@x.com',
        algorithm: 'SHA256', digits: 8, period: 30, counter: 0 },
      { type: 'hotp', secret: base32Encode(new Uint8Array(secret)), issuer: 'Beta', label: 'b@x.com',
        algorithm: 'SHA1', digits: 6, period: 30, counter: 42 },
    ]);
    expect(b.skipped).toEqual(['bad']);
    expect(b).toMatchObject({ batchSize: 2, batchIndex: 1, batchId: 777 });
  });

  it('rejects truncated data', () => {
    expect(() => parseMigrationUri(toUri([0x0a, 0x10, 0x01]))).toThrow();
  });

  it('dispatches by scheme', () => {
    expect(parseImportText('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP').accounts).toHaveLength(1);
    expect(() => parseImportText('hello')).toThrow();
  });
});
