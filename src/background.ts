import { AUTOLOCK_ALARM, clearSession } from './crypto/session';

chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTOLOCK_ALARM) void clearSession();
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;
  const { vault } = await chrome.storage.local.get('vault');
  if (!vault) await chrome.runtime.openOptionsPage();
});
