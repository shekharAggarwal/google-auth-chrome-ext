import { describe, expect, it } from 'vitest';
import { WrongPasswordError, decryptVault, deriveKeyBytes, encryptVault, randomBytes } from '../src/crypto/vault';
import { emptyVault } from '../src/storage/accounts';

const ITER = 1000; // fast for tests; production uses PBKDF2_ITERATIONS

describe('vault crypto', () => {
  it('round-trips and never stores plaintext', async () => {
    const salt = randomBytes(16);
    const key = await deriveKeyBytes('correct horse battery', salt, ITER);
    const data = emptyVault();
    data.accounts.push({
      id: '1', createdAt: 0, issuer: 'X', label: 'me', type: 'totp',
      secret: 'JBSWY3DPEHPK3PXP', algorithm: 'SHA1', digits: 6, period: 30, counter: 0,
    });
    const stored = await encryptVault(data, key, salt, ITER);
    expect(JSON.stringify(stored)).not.toContain('JBSWY3DPEHPK3PXP');
    expect(await decryptVault(stored, key)).toEqual(data);

    const again = await encryptVault(data, key, salt, ITER);
    expect(again.iv).not.toBe(stored.iv);
  });

  it('rejects the wrong password and tampering', async () => {
    const salt = randomBytes(16);
    const key = await deriveKeyBytes('right password', salt, ITER);
    const stored = await encryptVault(emptyVault(), key, salt, ITER);
    const wrong = await deriveKeyBytes('wrong password', salt, ITER);
    await expect(decryptVault(stored, wrong)).rejects.toBeInstanceOf(WrongPasswordError);

    const tampered = { ...stored, ct: stored.ct.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) };
    await expect(decryptVault(tampered, key)).rejects.toBeInstanceOf(WrongPasswordError);
  });
});
