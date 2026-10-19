import { decodeQrFromImage } from '../import/qr';
import { parseImportText } from '../import';
import { generateCode, secondsRemaining } from '../otp/totp';
import type { Account, VaultData } from '../storage/accounts';
import { hasVault, loadUnlocked, lock, saveVault, unlock } from '../storage/store';
import { $, errorMessage, formatCode, h, show } from './dom';
import { PENDING_IMPORT } from './pending';

let vault: VaultData | null = null;
let timer: number | undefined;

async function init(): Promise<void> {
  if (!(await hasVault())) return view('setup');
  vault = await loadUnlocked();
  if (vault) return renderUnlocked();
  view('locked');
}

function view(name: 'setup' | 'locked' | 'unlocked'): void {
  for (const id of ['setup', 'locked', 'unlocked']) show($(`#${id}`), id === name);
  if (name === 'locked') $<HTMLInputElement>('#password').focus();
}

// Auto-lock (alarm) or Lock on the manage page removes the session key: lock this view too.
chrome.storage.session.onChanged.addListener((changes) => {
  if ('vaultKey' in changes && changes.vaultKey?.newValue === undefined && vault) {
    vault = null;
    rows = [];
    window.clearInterval(timer);
    view('locked');
  }
});

$('#open-setup').addEventListener('click', () => void chrome.runtime.openOptionsPage());

$<HTMLFormElement>('#unlock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('#password');
  const err = $('#unlock-error');
  err.textContent = 'Unlocking…';
  try {
    vault = await unlock(input.value);
    input.value = '';
    err.textContent = '';
    renderUnlocked();
  } catch (ex) {
    err.textContent = errorMessage(ex);
    input.select();
  }
});

$('#lock').addEventListener('click', async () => {
  await lock();
  vault = null;
  window.clearInterval(timer);
  view('locked');
});

$('#manage').addEventListener('click', () => void chrome.runtime.openOptionsPage());
$<HTMLInputElement>('#search').addEventListener('input', renderList);

$('#scan').addEventListener('click', async () => {
  const status = $('#status');
  try {
    status.textContent = 'Scanning…';
    const shot = await chrome.tabs.captureVisibleTab({ format: 'png' });
    const text = await decodeQrFromImage(shot);
    if (!text) throw new Error('No QR code found on this page');
    parseImportText(text); // validate before handing off
    await chrome.storage.session.set({ [PENDING_IMPORT]: [text] });
    await chrome.tabs.create({ url: chrome.runtime.getURL('manage.html#import') });
    window.close();
  } catch (ex) {
    status.textContent = errorMessage(ex);
  }
});

interface Row {
  account: Account;
  code: HTMLSpanElement;
  timer: HTMLSpanElement | null;
  current: string;
}
let rows: Row[] = [];

function renderUnlocked(): void {
  view('unlocked');
  renderList();
  window.clearInterval(timer);
  timer = window.setInterval(() => void tick(), 1000);
  $<HTMLInputElement>('#search').focus();
}

/** Rebuild the list (on load/search). Codes are refreshed in place by tick() so clicks aren't lost. */
function renderList(): void {
  if (!vault) return;
  const q = $<HTMLInputElement>('#search').value.trim().toLowerCase();
  const accounts = vault.accounts.filter((a) => `${a.issuer} ${a.label}`.toLowerCase().includes(q));
  show($('#empty'), vault.accounts.length === 0);
  rows = accounts.map(buildRow);
  $('#codes').replaceChildren(...rows.map((r) => r.code.closest('li')!));
  void tick();
}

function buildRow(a: Account): Row {
  const code = h('span', { class: 'code' }, '••• •••');
  const row: Row = { account: a, code, timer: null, current: '' };
  const copy = async () => {
    if (!row.current) return;
    await navigator.clipboard.writeText(row.current);
    flash(`Copied ${a.issuer || a.label}`);
  };
  row.timer = a.type === 'totp' ? h('span', { class: 'timer' }) : null;
  h(
    'li',
    { class: 'code-item' },
    h(
      'button',
      { class: 'code-main', title: 'Click to copy', onclick: () => void copy() },
      h('span', { class: 'issuer' }, a.issuer || a.label),
      a.issuer ? h('span', { class: 'label' }, a.label) : null,
      code,
    ),
    row.timer ?? h('button', { class: 'next', title: 'Next code', onclick: () => void nextHotp(a.id) }, '↻'),
  );
  return row;
}

async function tick(): Promise<void> {
  await Promise.all(
    rows.map(async (r) => {
      const a = r.account;
      r.current = await generateCode(a);
      r.code.textContent = formatCode(r.current);
      if (!r.timer) return;
      const remaining = secondsRemaining(a.period);
      r.code.classList.toggle('expiring', remaining <= 5);
      r.timer.textContent = String(remaining);
      r.timer.title = `${remaining}s left`;
      r.timer.style.setProperty('--p', String(remaining / a.period));
    }),
  );
}

async function nextHotp(id: string): Promise<void> {
  if (!vault) return;
  const a = vault.accounts.find((x) => x.id === id);
  if (!a) return;
  a.counter += 1;
  await saveVault(vault);
  await tick();
}

let flashTimer: number | undefined;
function flash(msg: string): void {
  const status = $('#status');
  status.textContent = msg;
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => (status.textContent = ''), 1500);
}

void init();
