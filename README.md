# Private Authenticator (Chrome extension)

An offline, encrypted replacement for Google Authenticator that lives in Chrome. It generates TOTP/HOTP codes, imports Google Authenticator exports, and makes **zero network requests**.

## Security model

| | |
|---|---|
| Storage | Accounts are encrypted with **AES-256-GCM**. The key comes from your master password via **PBKDF2-SHA256** (600,000 iterations, random salt). Only ciphertext goes into `chrome.storage.local`. |
| Unlocked state | The derived key is held in `chrome.storage.session` (memory only, trusted extension pages only). It's wiped on auto-lock, on **Lock**, and when Chrome closes. |
| Network | CSP `connect-src 'none'`, no host permissions, no content scripts, no remote code. |
| Permissions | `storage`, `alarms` (auto-lock), `activeTab` (only used when you press **Scan** to screenshot the current tab). |
| Brute force | After 3 wrong passwords, unlock attempts back off exponentially (up to 5 min). |
| Crypto | Browser WebCrypto only. One runtime dependency: [`jsqr`](https://github.com/cozmo/jsQR) for QR decoding. |

**Know the trade-offs:**
- **No backup.** If you uninstall the extension, delete the Chrome profile or forget the password, the codes are gone for good. Keep the phone app (or your sites' recovery codes) until you've confirmed every account works.
- If your computer is compromised, keeping 2FA codes in the same browser as your passwords weakens the "second factor".

## Build

```bash
npm ci
npm test            # RFC 4226/6238 vectors, import parsers, vault crypto
npm run build       # -> dist/
npm run zip         # -> release/google-auth-ext-<version>.zip
# or all of it, with npm audit:
npm run release
```

## Install from the zip

Chrome can't install a `.zip` directly. Load it unpacked instead:

1. Unzip `release/google-auth-ext-<version>.zip` into a **permanent** folder, e.g. `~/Extensions/private-authenticator`.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick that folder.
4. Pin the extension. The Manage page opens on first install so you can set your master password.

`manifest.json` has a fixed `key`, so the extension ID (and the encrypted vault tied to it) stays the same even if you move the folder.

**Updating:** replace the folder's contents with the new zip's contents, then click **Reload** on `chrome://extensions`. Your vault is kept.

> Do **not** click "Remove" on the extension. That deletes the vault.

## Move your codes from Google Authenticator

1. On your phone, open Google Authenticator → **☰ → Transfer accounts → Export accounts** and select all.
2. The app shows one or more QR codes. For each one, do either:
   - take a screenshot or photo and drop/choose/paste the images on the extension's **Manage** page, or
   - show the QR on your screen in a browser tab and press **Scan** in the popup.
3. Review the list and click **Save selected**. If there are several QR codes, the page shows "QR 1 of 3", so you know when you have them all.
4. Compare a few codes with the phone, then sign in to each important site once to confirm.
5. **Delete the screenshots/photos.** They contain your raw secrets.

You can also add accounts from an `otpauth://` link or by typing the secret manually. Many sites show a "can't scan? enter this key" option when you set up 2FA.

> Signing in with Google can't import your codes. Google Authenticator's cloud sync has no public API; the export QR is the only way to get them out.

## Project layout

```
public/manifest.json      MV3 manifest (CSP, permissions, fixed key)
src/background.ts         auto-lock alarm → wipes session key
src/crypto/               PBKDF2 + AES-GCM vault, session key handling
src/otp/                  base32, HOTP/TOTP (WebCrypto HMAC)
src/import/               otpauth://, otpauth-migration:// (protobuf), QR decoding
src/storage/              account model, encrypted vault store, unlock throttling
src/ui/                   popup (codes) and manage page (setup, import, edit)
scripts/                  zip packaging, icon generator
tests/                    vitest
```
