import { type ParsedImport, parseImportText } from '../import';
import { decodeQrFromImage } from '../import/qr';
import { base32Decode } from '../otp/base32';
import type { Algorithm } from '../otp/totp';
import { type NewAccount, type VaultData, createAccount, displayName, isDuplicate, normalizeSecret } from '../storage/accounts';
import {
  MIN_PASSWORD_LENGTH, changePassword, createVault, hasVault, loadUnlocked, lock, saveVault, unlock,
} from '../storage/store';
import { $, errorMessage, h, show } from './dom';
import { PENDING_IMPORT } from './pending';

let vault: VaultData | null = null;
interface PendingItem { account: NewAccount; selected: boolean; duplicate: boolean }
let pending: PendingItem[] = [];
const batchesSeen = new Map<number, Set<number>>(); // batchId -> indexes received

async function init(): Promise<void> {
  if (!(await hasVault())) return view('setup');
  vault = await loadUnlocked();
  if (!vault) return view('locked');
  await onUnlocked();
}

function view(name: 'setup' | 'locked' | 'unlocked'): void {
  for (const id of ['setup', 'locked', 'unlocked']) show($(`#${id}`), id === name);
  if (name === 'locked') $<HTMLInputElement>('#password').focus();
  if (name === 'setup') $<HTMLInputElement>('#new-pw').focus();
}

async function onUnlocked(): Promise<void> {
  view('unlocked');
  $<HTMLSelectElement>('#autolock').value = String(vault!.settings.autoLockMinutes);
  renderAccounts();
  await consumePendingScan();
}

// Lock everywhere when the session key disappears (auto-lock alarm, or Lock in the popup).
chrome.storage.session.onChanged.addListener((changes) => {
  if ('vaultKey' in changes && changes.vaultKey?.newValue === undefined && vault) {
    vault = null;
    pending = [];
    renderPreview();
    view('locked');
  }
});

/** Save, or bounce to the lock screen if the vault locked meanwhile. */
async function persist(): Promise<void> {
  try {
    await saveVault(vault!);
  } catch (e) {
    vault = null;
    view('locked');
    throw e;
  }
}

/* ---------- setup / unlock ---------- */

function passwordHint(pw: string): string {
  if (!pw) return '';
  if (pw.length < MIN_PASSWORD_LENGTH) return `Too short — at least ${MIN_PASSWORD_LENGTH} characters.`;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length >= 16 || (pw.length >= 12 && classes >= 3)) return 'Strong.';
  return 'OK — a longer passphrase (4+ random words) is stronger.';
}

$<HTMLInputElement>('#new-pw').addEventListener('input', (e) => {
  $('#pw-hint').textContent = passwordHint((e.target as HTMLInputElement).value);
});

$<HTMLFormElement>('#setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $<HTMLInputElement>('#new-pw').value;
  const err = $('#setup-error');
  if (pw !== $<HTMLInputElement>('#new-pw2').value) return void (err.textContent = 'Passwords do not match.');
  try {
    err.textContent = 'Creating…';
    vault = await createVault(pw);
    err.textContent = '';
    (e.target as HTMLFormElement).reset();
    await onUnlocked();
  } catch (ex) {
    err.textContent = errorMessage(ex);
  }
});

$<HTMLFormElement>('#unlock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('#password');
  const err = $('#unlock-error');
  try {
    err.textContent = 'Unlocking…';
    vault = await unlock(input.value);
    input.value = '';
    err.textContent = '';
    await onUnlocked();
  } catch (ex) {
    err.textContent = errorMessage(ex);
    input.select();
  }
});

$('#lock').addEventListener('click', async () => {
  await lock();
  vault = null;
  view('locked');
});

/* ---------- import ---------- */

function status(msg: string, isError = false): void {
  const el = $('#import-status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

function addParsed(result: ParsedImport, source: string): string {
  let added = 0;
  for (const account of result.accounts) {
    if (pending.some((p) => normalizeSecret(p.account.secret) === normalizeSecret(account.secret))) continue;
    const duplicate = isDuplicate(vault!.accounts, account);
    pending.push({ account, selected: !duplicate, duplicate });
    added++;
  }
  let msg = `${source}: ${added} account${added === 1 ? '' : 's'} found`;
  if (result.skipped.length) msg += `; skipped unsupported: ${result.skipped.join(', ')}`;
  if (result.batch && result.batch.size > 1) {
    const seen = batchesSeen.get(result.batch.id) ?? new Set<number>();
    seen.add(result.batch.index);
    batchesSeen.set(result.batch.id, seen);
    msg += ` (QR ${seen.size} of ${result.batch.size}${seen.size < result.batch.size ? ' — add the remaining QR codes' : ''})`;
  }
  renderPreview();
  return msg;
}

async function importFiles(files: Iterable<File>): Promise<void> {
  const messages: string[] = [];
  let failed = false;
  for (const file of files) {
    try {
      const text = await decodeQrFromImage(file);
      if (!text) throw new Error('no QR code found');
      messages.push(addParsed(parseImportText(text), file.name));
    } catch (ex) {
      failed = true;
      messages.push(`${file.name}: ${errorMessage(ex)}`);
    }
  }
  status(messages.join('\n'), failed);
}

async function consumePendingScan(): Promise<void> {
  const got = await chrome.storage.session.get(PENDING_IMPORT);
  const texts = got[PENDING_IMPORT] as string[] | undefined;
  if (!texts?.length) return;
  await chrome.storage.session.remove(PENDING_IMPORT);
  status(texts.map((t) => addParsed(parseImportText(t), 'Scanned page')).join('\n'));
}

const filesInput = $<HTMLInputElement>('#files');
filesInput.addEventListener('change', async () => {
  await importFiles(filesInput.files ?? []);
  filesInput.value = '';
});

const drop = $('#drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  void importFiles([...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/')));
});

// Pasting a screenshot anywhere on the page imports it.
document.addEventListener('paste', (e) => {
  if (!vault || (e.target as HTMLElement).closest('input, textarea')) return;
  const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) void importFiles(files);
});

$<HTMLFormElement>('#uri-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('#uri');
  try {
    status(addParsed(parseImportText(input.value), 'Link'));
    input.value = '';
  } catch (ex) {
    status(errorMessage(ex), true);
  }
});

$<HTMLFormElement>('#manual-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const f = new FormData(form);
  const get = (k: string) => String(f.get(k) ?? '').trim();
  try {
    const secret = get('secret');
    base32Decode(secret);
    const account: NewAccount = {
      type: get('type') === 'hotp' ? 'hotp' : 'totp',
      issuer: get('issuer'),
      label: get('label'),
      secret,
      algorithm: get('algorithm') as Algorithm,
      digits: Number(get('digits')),
      period: Number(get('period')) || 30,
      counter: 0,
    };
    status(addParsed({ accounts: [account], skipped: [] }, 'Manual entry'));
    form.reset();
  } catch (ex) {
    status(errorMessage(ex), true);
  }
});

function renderPreview(): void {
  show($('#preview'), pending.length > 0);
  $('#preview-list').replaceChildren(
    ...pending.map((p) =>
      h(
        'li',
        {},
        h(
          'label',
          { class: 'row' },
          h('input', {
            type: 'checkbox',
            ...(p.selected ? { checked: true } : {}),
            onchange: (e) => (p.selected = (e.target as HTMLInputElement).checked),
          }),
          h('span', {}, displayName(p.account)),
          h('span', { class: 'muted small' }, `${p.account.type.toUpperCase()} · ${p.account.algorithm} · ${p.account.digits} digits`),
          p.duplicate ? h('span', { class: 'badge' }, 'already saved') : null,
        ),
      ),
    ),
  );
}

$('#save-preview').addEventListener('click', async () => {
  const chosen = pending.filter((p) => p.selected).map((p) => createAccount(p.account));
  vault!.accounts.push(...chosen);
  try {
    await persist();
    pending = [];
    batchesSeen.clear();
    renderPreview();
    renderAccounts();
    status(`Saved ${chosen.length} account${chosen.length === 1 ? '' : 's'}. Compare a few codes with your phone before removing anything there.`);
  } catch (ex) {
    status(errorMessage(ex), true);
  }
});

$('#clear-preview').addEventListener('click', () => {
  pending = [];
  batchesSeen.clear();
  renderPreview();
  status('');
});

/* ---------- account list ---------- */

function renderAccounts(): void {
  const accounts = vault!.accounts;
  $('#count').textContent = `(${accounts.length})`;
  $('#accounts').replaceChildren(
    ...accounts.map((a, i) => {
      const issuer = h('input', { value: a.issuer, placeholder: 'Issuer', 'aria-label': 'Issuer' });
      const label = h('input', { value: a.label, placeholder: 'Account', 'aria-label': 'Account' });
      const commit = async () => {
        if (issuer.value === a.issuer && label.value === a.label) return;
        a.issuer = issuer.value.trim();
        a.label = label.value.trim();
        await persist();
      };
      issuer.addEventListener('change', () => void commit());
      label.addEventListener('change', () => void commit());

      const del = h('button', { class: 'danger' }, 'Delete');
      del.addEventListener('click', async () => {
        if (del.dataset.armed !== '1') {
          del.dataset.armed = '1';
          del.textContent = 'Really delete?';
          window.setTimeout(() => { del.dataset.armed = ''; del.textContent = 'Delete'; }, 3000);
          return;
        }
        vault!.accounts = vault!.accounts.filter((x) => x.id !== a.id);
        await persist();
        renderAccounts();
      });

      return h(
        'li',
        { class: 'row account' },
        issuer,
        label,
        h('span', { class: 'muted small' }, `${a.type.toUpperCase()} · ${a.algorithm}`),
        h('button', { title: 'Move up', ...(i === 0 ? { disabled: true } : {}), onclick: () => void move(i, -1) }, '↑'),
        h('button', { title: 'Move down', ...(i === accounts.length - 1 ? { disabled: true } : {}), onclick: () => void move(i, 1) }, '↓'),
        del,
      );
    }),
  );
}

async function move(i: number, delta: number): Promise<void> {
  const list = vault!.accounts;
  const j = i + delta;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j]!, list[i]!];
  await persist();
  renderAccounts();
}

/* ---------- security settings ---------- */

$<HTMLSelectElement>('#autolock').addEventListener('change', async (e) => {
  vault!.settings.autoLockMinutes = Number((e.target as HTMLSelectElement).value);
  await persist();
  $('#security-status').textContent = 'Auto-lock updated.';
});

$<HTMLFormElement>('#change-pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = $('#security-status');
  const next = $<HTMLInputElement>('#chg-pw').value;
  if (next !== $<HTMLInputElement>('#chg-pw2').value) return void (out.textContent = 'New passwords do not match.');
  try {
    out.textContent = 'Re-encrypting…';
    await changePassword($<HTMLInputElement>('#old-pw').value, next);
    (e.target as HTMLFormElement).reset();
    out.textContent = 'Password changed.';
  } catch (ex) {
    out.textContent = errorMessage(ex);
  }
});

void init();
