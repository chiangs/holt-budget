# 0041 Encrypted SQLite in Electron (spike S2)

Status: accepted.
Date: 2026-11-09

## Question
Does better-sqlite3-multiple-ciphers work in Electron 45, in dev and in the packaged builds? Can Holt keep one data key in two copies (the keyring, or a passphrase when there is no keyring, plus the recovery code), refuse `basic_text`, and restore a backup on a fresh account with only the recovery code?

## What was built
The storage code is in `apps/desktop/src/main/storage/`. It is the start of the real thing, not throwaway spike code.
- `keys.ts` has the data key, Argon2id key wrapping with AES-256-GCM, recovery codes, and the `keys.json` schema. It uses no Electron.
- `database.ts` opens the encrypted database, and writes and restores backups. It uses no Electron.
- `keystore.ts` holds the daily copy in the keyring through `safeStorage`, or behind a passphrase, and refuses `basic_text`.
- `storage.test.ts` has 16 Vitest tests that run in CI under plain Node.
- `s2-check.ts` runs the whole sequence inside the app with no window: `holt --holt-s2-check=full --holt-s2-dir=<folder>`, or `--holt-s2-check=restore` with `--holt-s2-backup=<file>` and `HOLT_RECOVERY_CODE` set.

## Findings
- **No rebuild for Electron.** Version 13.0.3 ships Node-API binaries for each platform inside the npm package, with no install script. They don't depend on Electron's ABI (150 for Electron 45), so nothing goes in `allowBuilds` and nothing needs rebuilding.
- **Encryption works.** The default cipher is ChaCha20-Poly1305 and WAL mode works. The file has no plain SQLite header, and a wrong or missing key gets "file is not a database". Holt passes the 256-bit key as `PRAGMA hexkey`, so no key derivation runs on open.
- **SQLite's backup API can't copy an encrypted database here.** `db.backup()` fails with "backup is not supported with incompatible source and target databases", because better-sqlite3 opens the target without a key. `VACUUM INTO` writes a consistent copy encrypted with the same key, so backups use that.
- **Node's Argon2 fails inside Electron.** `crypto.argon2` is a function in Electron 45's Node 24.22, but calling it fails with "Argon2 algorithm not supported", because Electron builds Node against BoringSSL. `hash-wasm` (WebAssembly, MIT) replaces it, so there is still only one native module. Its code has no network calls. The only URL in it is in the licence comment.
- **The synchronous `safeStorage` calls are deprecated in Electron 45.** Holt uses `encryptStringAsync`, `decryptStringAsync` and `isAsyncEncryptionAvailable`. When `decryptStringAsync` reports `shouldReEncrypt`, Holt writes the keyring copy again.
- **The keyring works when forced.** With `--password-store=gnome-libsecret` (added when `org.freedesktop.secrets` is on the session bus), `getSelectedStorageBackend()` reports `gnome_libsecret`.
- **`basic_text` is refused.** With `--password-store=basic` and no passphrase, setup fails with "No keyring is available, so Holt needs a passphrase." With a passphrase, the Argon2id copy unlocks.
- **The pacman package waits.** electron-builder needs a homepage, an author email and a maintainer, which a public package publishes. Stephen chose `install.sh` for now, like Fenmyr (0042).
- **The packaged AppImage works.** electron-builder unpacks the native module to `app.asar.unpacked` by itself. In the AppImage, the full check passes with the keyring, and `basic_text` is refused.
  - The package also carries the prebuilt binaries for macOS, Windows, musl and arm64, about 20 MB that Linux x64 never loads. Trimming them is a packaging task for Milestone 1.
  - The packaged run adds an entry for Holt to the keyring of the account that runs it.
- **Restore without a keyring works (simulated).** Under `env -i`, with no session bus and no display, the AppImage restored a backup made on Stephen's account with only the recovery code, typed in lower case with spaces. It then stored the key behind a new passphrase and kept the backup's recovery copy, so the same code keeps working.

## Results
| Run | Daily copy | Result |
|---|---|---|
| Dev, keyring | `gnome_libsecret` | Pass |
| Dev, `basic_text`, no passphrase | none | Refused, as intended |
| Dev, `basic_text`, passphrase | passphrase | Pass |
| AppImage, keyring | `gnome_libsecret` | Pass |
| AppImage, `basic_text`, no passphrase | none | Refused, as intended |
| AppImage, restore with no session bus (simulated) | passphrase | Pass |
| AppImage, restore on the `holt-restore` account (no keyring) | passphrase | Pass |
| `install.sh` build, keyring | `gnome_libsecret` | Pass |
| `install.sh` build, `basic_text`, no passphrase | none | Refused, as intended |
| `install.sh` build, `basic_text`, passphrase | passphrase | Pass |

## Restore on a fresh account
Stephen ran the restore as `holt-restore`, a new account with no keyring and no access to his files. With only the recovery code, the AppImage opened a backup made on Stephen's account. It read the data back, and it stored the key behind that account's own passphrase. The account is kept for the release checklist (§14).

## Verdict
better-sqlite3-multiple-ciphers is the storage for Holt. Every check passes in dev, in the AppImage and in the `install.sh` build. The open work is in Milestone 1: trim the other platforms' binaries from the package, and build the unlock and recovery-code screens on `keystore.ts`.
