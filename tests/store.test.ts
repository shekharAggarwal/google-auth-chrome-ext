import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-ins for the chrome.* APIs the store uses.
function area() {
  let data: Record<string, unknown> = {};
  return {
    get: async (key: string) => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async (items: Record<string, unknown>) => void Object.assign(data, structuredClone(items)),
    remove: async (key: string) => void delete data[key],
    reset: () => (data = {}),
    raw: () => data,
  };
}
const local = area();
const session = area();
vi.stubGlobal('chrome', {
  storage: { local, session },
  alarms: { create: async () => {}, clear: async () => true },
});

const store = await import('../src/storage/store');
const { createAccount } = await import('../src/storage/accounts');

const PW = 'correct horse battery';

describe('vault store', () => {
  beforeEach(() => {
    local.reset();
    session.reset();
  });

  it('creates, locks, unlocks and keeps only ciphertext on disk', async () => {
    expect(await store.hasVault()).toBe(false);
    const data = await store.createVault(PW);
    data.accounts.push(createAccount({
      type: 'totp', issuer: 'GitHub', label: 'me', secret: 'JBSWY3DPEHPK3PXP',
      algorithm: 'SHA1', digits: 6, period: 30, counter: 0,
    }));
    await store.saveVault(data);
    expect(JSON.stringify(local.raw())).not.toContain('JBSWY3DPEHPK3PXP');

    await store.lock();
    expect(await store.loadUnlocked()).toBeNull();
    await expect(store.saveVault(data)).rejects.toThrow('locked');

    const unlocked = await store.unlock(PW);
    expect(unlocked.accounts[0]?.issuer).toBe('GitHub');
    expect((await store.loadUnlocked())?.accounts).toHaveLength(1);
  });

  it('rejects short passwords and a second vault', async () => {
    await expect(store.createVault('short')).rejects.toThrow();
    await store.createVault(PW);
    await expect(store.createVault(PW)).rejects.toThrow('already exists');
  });

  it('throttles after repeated wrong passwords and resets on success', async () => {
    await store.createVault(PW);
    await store.lock();
    await expect(store.unlock('wrong one')).rejects.toThrow('Wrong password');
    await expect(store.unlock('wrong two')).rejects.toThrow('Wrong password');
    expect(await store.unlockWaitMs()).toBe(0);
    await expect(store.unlock('wrong three')).rejects.toThrow('Wrong password');
    expect(await store.unlockWaitMs()).toBeGreaterThan(0);
    await expect(store.unlock(PW)).rejects.toThrow('Too many attempts');

    local.raw().unlockThrottle = { failures: 3, retryAt: 0 }; // pretend the wait elapsed
    await store.unlock(PW);
    expect(local.raw().unlockThrottle).toBeUndefined();
  });

  it('changes the password without losing accounts', async () => {
    const data = await store.createVault(PW);
    data.accounts.push(createAccount({
      type: 'hotp', issuer: 'Bank', label: 'me', secret: 'GEZDGNBVGY3TQOJQ',
      algorithm: 'SHA1', digits: 6, period: 30, counter: 7,
    }));
    await store.saveVault(data);
    const saltBefore = (local.raw().vault as { kdf: { salt: string } }).kdf.salt;

    await expect(store.changePassword('not the password', 'new password 123')).rejects.toThrow();
    await store.changePassword(PW, 'new password 123');
    expect((local.raw().vault as { kdf: { salt: string } }).kdf.salt).not.toBe(saltBefore);

    // Still unlocked in this session with the new key, and data persists across lock.
    expect((await store.loadUnlocked())?.accounts).toHaveLength(1);
    await store.lock();
    await expect(store.unlock(PW)).rejects.toThrow('Wrong password');
    const after = await store.unlock('new password 123');
    expect(after.accounts[0]).toMatchObject({ issuer: 'Bank', counter: 7, secret: 'GEZDGNBVGY3TQOJQ' });
  });
});
