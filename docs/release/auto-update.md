# Releasing and auto-update

The installed Nova app updates itself from **GitHub Releases** on `AverageNftEnjoyer/Nova` (a public repo, so the app needs no token). It is **not code-signed**: Windows SmartScreen shows an "unrecognized app" warning on the first install. Updates are fetched over HTTPS and checked against the SHA-512 in `latest.yml`.

## How the app updates

- 30 seconds after launch, then every 6 hours, the app checks the latest published release.
- A newer version downloads in the background, then a dialog offers **Restart now / Later**. Choosing Later installs it silently the next time Nova is closed.
- Tray icon -> **Check for Updates...** runs a check on demand and says when Nova is up to date.
- Only the installed app updates. `npm run dev`, `electron:dev` and the unpacked `--dir` build have no update feed and never check.
- Nova installs per-user, so updating needs no admin prompt. User data in `%APPDATA%\Nova` is never touched by an update.

## Shipping a new version

1. Bump `NOVA_VERSION` (e.g. `"V.69 Alpha"`) and add a history entry in `hud/lib/meta/version/index.ts`. That is the only place to bump. `hud/package.json`, the repo-root `package.json` and both lockfiles follow automatically (V.XX -> `0.XX.0`): `npm run version:sync` runs at the start of every `electron:build*` and `electron:publish:win`. electron-updater compares that version with the release, so it must track `NOVA_VERSION`; `npm run smoke:version-sync` fails if it ever drifts.
2. Close any running Nova (a running `Nova.exe` locks the build output).
3. Create a GitHub personal access token with `repo` scope and set it for the shell: `$env:GH_TOKEN = "<token>"`.
4. From `hud/`: `npm run electron:publish:win`. This builds, stages the runtime, builds the installer and uploads `Nova-<version>-Setup.exe`, its blockmap and `latest.yml` to a **draft** release named `v<version>`.
5. On GitHub, open Releases, check the draft, and click **Publish release**. Installed apps see it on their next check. Until published, nobody is offered it.

Do not publish a release you have not installed and launched yourself first.

## Testing the update path

1. Install the current build with its `Nova-<version>-Setup.exe`.
2. Publish a newer release as above.
3. In the installed app: tray -> Check for Updates... -> the update downloads -> Restart now -> confirm the new version and that name, photo, settings and background are still there.

## Limits

- Updates cannot be tested from the unpacked build.
- Unsigned installers keep triggering SmartScreen; that is a certificate cost, not a bug.
