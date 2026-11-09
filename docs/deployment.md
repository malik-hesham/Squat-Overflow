# Deployment and releases

The release workflow ships the extension. Breaks need no server: pose detection, rep counting and form scoring run in the extension (and in the mobile app), and camera frames never leave the device. The API server in `server/` is optional. It adds Google sign-in, the team leaderboard and cross-device sync, and you run it yourself.

| Part | Where it runs | Deployed by |
|------|---------------|-------------|
| API server: sign-in, leaderboard and sync (`server/`, optional) | Any container host you choose, from `server/Dockerfile` | You (not automated) |
| Leaderboard database | Postgres at `DATABASE_URL` | Schema migrations run when the server starts |
| Extension (`extension/`) | Chrome Web Store | `scripts/publish-cws.mjs` in the release workflow |

```
PR / push to main ── CI (.github/workflows/ci.yml)
                     server tests (incl. auth, leaderboard and migrations on in-process Postgres) · extension tests
                     · build script tests · store zip (for API_URL, or local only) · Docker image smoke test

tag vX.Y.Z ──────── Release (.github/workflows/release.yml)
                     verify tag == manifest version → CI (builds the zip)
                     → GitHub Release (+ zip) → Chrome Web Store (submit for review)
```

## Running the API server

Build and run the image anywhere that can serve HTTPS:

```bash
docker build --build-arg VERSION=v0.4.0 -t squat-overflow-api server
docker run -p 8080:8080 \
  -e FORMCOACH_ALLOWED_ORIGINS='chrome-extension://lpkaoaegdjhciohkfidnmabjigidofnd' \
  -e GOOGLE_CLIENT_ID='<the client ID in extension/config.js>' \
  -e DATABASE_URL='postgres://…' \
  -e AUTH_JWT_SECRET="$(openssl rand -base64 48)" \
  squat-overflow-api
```

| Variable | Purpose |
|----------|---------|
| `FORMCOACH_ALLOWED_ORIGINS` | Extension origins allowed to call the API (CORS), comma-separated. Start with the unpacked dev ID; add `chrome-extension://<store-id>` after the first store upload. |
| `GOOGLE_CLIENT_ID` | Google sign-in ID tokens must be issued for this client. Must match `extension/config.js`. |
| `DATABASE_URL` | Postgres 13+ for accounts, the leaderboard and sync. Use `sslmode=require` over the internet. Without it, those endpoints answer 503. |
| `AUTH_JWT_SECRET` | Signs session tokens. Changing it signs every user out; they sign in again with one click. |

Put TLS in front of the container (a load balancer, reverse proxy or the host's own HTTPS) and check `https://<host>/health` and `https://<host>/privacy`.

**On one machine:** [`deploy/docker-compose.yml`](../deploy/docker-compose.yml) runs the server, Postgres and Caddy (automatic Let's Encrypt HTTPS) together. [aws-free-plan.md](aws-free-plan.md) walks through it on a single EC2 instance within the AWS Free plan's credits, including updates, rollback and backups.

Clients only call the server while the user is signed in. Signed out, or with the server down, breaks still run and are saved on the device; signed-in clients queue their breaks and upload them when the server is back.

Deploy the server before tagging a release whose extension needs new server behaviour. **Keep the API backward compatible** (add fields, don't rename or remove them), because store updates wait for review and old extensions keep talking to the new server.

**Old extension builds:** versions before the on-device pose model streamed camera frames to the server over `/ws`, which this server no longer has. Ship the extension update first; until users have it, their breaks fall back to the manual instructions.

## Releasing a version

1. In a PR, bump `"version"` in `extension/manifest.json`. Use semver; the store rejects a version that isn't higher than the live one. Add a row to the version history in `CHROMEWEBSTORE.md`. Merge the PR.
2. Tag the merge commit on `main` and push the tag:
   ```bash
   git checkout main && git pull
   git tag v0.4.0
   git push origin v0.4.0
   ```
3. Watch **Actions → Release**:
   - The GitHub Release is created with notes generated from merged PRs and the store zip attached.
   - The store job uploads the zip and submits it for review. It goes live automatically once Google approves it, usually within a few days.

If a job fails, fix the cause on `main`, delete the tag (`git push --delete origin vX.Y.Z && git tag -d vX.Y.Z`), and tag again. The release step attaches the zip to an existing release instead of failing.

## Local development

"Load unpacked" on `extension/` runs breaks on its own and calls `http://127.0.0.1:8765`, the local API server from the README, for sign-in and sync. Build a store zip locally with:

```bash
node scripts/build-extension.mjs                                  # local only: no sign-in, leaderboard or sync
API_URL=https://api.example.com node scripts/build-extension.mjs   # with your API server
```

The command writes `dist/extension/` (load it unpacked to try the store build) and `dist/squat-overflow-<version>.zip`. `API_URL` is optional and must be `https://`. The build differs from `extension/` like this:
- `config.js`'s `API_URL` is your server, or `""` for a local-only build, which hides sign-in and the leaderboard and makes no requests of its own.
- The manifest CSP `connect-src` loses the localhost entries and gains `API_URL`'s origin.
- The manifest `key` is removed.
- `tests/`, `scripts/` and the type-checking files (`tsconfig.json`, `*.d.ts`, `*.d.mts`, `node_modules/`) are left out.

The zip carries the MediaPipe runtime and pose model (`extension/lib/vendor/mediapipe/`, refreshed with `cd extension && npm run vendor`), so it is about 10 MB. `node --test 'scripts/tests/*.test.mjs'` checks the build.

## Database migrations

Schema changes go in a **new** entry at the end of `server/src/db/migrations.ts`. Never edit a migration that has already been released: the server only runs entries it hasn't recorded in `schema_migrations`. Each runs in a transaction when the server starts; an advisory lock keeps two instances from migrating at once. The server tests apply every migration to an in-process Postgres (PGlite) on each PR.

Demo data for the leadliaison.com board: `psql "$DATABASE_URL" -f server/scripts/demo-seed.sql`; remove it with `server/scripts/demo-clear.sql`.

## One-time setup

You need admin access to the GitHub repo and owner access to the Google Cloud and Chrome Web Store accounts. For sign-in, the leaderboard and sync you also need a running API server (above). Do the steps in this order.

### 1. Point the extension at your API server (optional)
In **Settings → Secrets and variables → Actions → Variables**, set `API_URL` to `https://<host>`. It replaces the old `POSE_SERVER_URL` variable, which you can delete. Without `API_URL`, CI and releases build a local-only zip.

### 2. GitHub
In **Settings → Environments**, create `production`. Optionally, add yourself as a required reviewer so every store submission waits for a click. Then add:

| Kind | Name | Value |
|------|------|-------|
| Variable | `API_URL` | `https://<host>` (repository variable, step 1; optional) |
| Secret | `CWS_SERVICE_ACCOUNT_JSON` | Service-account JSON key from step 4 |
| Variable | `CWS_PUBLISHER_ID` | Developer Dashboard → Publisher → Settings |
| Variable | `CWS_ITEM_ID` | The store item ID (= extension ID) from step 3. While this is empty, releases skip the store job. |

### 3. Chrome Web Store: first upload (manual)
The API can't create a store item, so the first version is uploaded by hand:
1. Register a developer account at https://chrome.google.com/webstore/devconsole (one-time fee).
2. Run `API_URL=https://<host> node scripts/build-extension.mjs` (or with no `API_URL` for a local-only build), then click **Add new item** and upload `dist/squat-overflow-<version>.zip`.
3. Fill in the **Store listing** and **Privacy** tabs from `CHROMEWEBSTORE.md`. Add screenshots. Replace the placeholder contact email in `server/static/privacy.html` first; the policy URL is `https://<host>/privacy`.
4. Note the **item ID**: it is the store extension ID. Then:
   - Set `CWS_ITEM_ID` (step 2).
   - Add `chrome-extension://<item-id>` to the server's `FORMCOACH_ALLOWED_ORIGINS`. Keep the dev ID, comma-separated, and restart the server.
   - In Google Cloud Console → Credentials → the OAuth client from `extension/config.js`, add the redirect URI `https://<item-id>.chromiumapp.org/`. For users outside the test-user list, the `calendar.freebusy` scope may need OAuth consent-screen verification.
5. Submit for review. Later versions go through the release workflow.

### 4. Chrome Web Store API (automated uploads)
1. In a Google Cloud project, enable the **Chrome Web Store API**.
2. Create a service account. It needs no IAM roles. Create a JSON key for it and save the key as `CWS_SERVICE_ACCOUNT_JSON`.
3. In the Developer Dashboard, under **Account**, add the service account's email. Only one service account is allowed per publisher.

## Rollback

| Part | How |
|------|-----|
| API server | Redeploy the previous image on your host. |
| Database | Add a new migration that reverts the change and deploy it. Don't edit or delete applied migrations. An older server image ignores migrations it doesn't know, so roll the server back only to a release whose code works with the current schema. |
| Extension | Developer Dashboard → the item → roll back to the previous published version (the API has a `rollback` method too), or publish a fixed higher version. |

Camera frames are processed on the device and never sent to any server. See `server/static/privacy.html`.
