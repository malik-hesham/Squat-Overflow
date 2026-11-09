# Deployment and releases

Squat Overflow has no hosted pose server. The release workflow ships the extension; you run the server yourself.

| Part | Where it runs | Deployed by |
|------|---------------|-------------|
| Pose server, sign-in, leaderboard and sync API (`server/`) | Any container host you choose, from `server/Dockerfile` | You (not automated) |
| Leaderboard database | Postgres at `DATABASE_URL` | Schema migrations run when the server starts |
| Extension (`extension/`) | Chrome Web Store | `scripts/publish-cws.mjs` in the release workflow |

```
PR / push to main ── CI (.github/workflows/ci.yml)
                     server tests (incl. auth, leaderboard and migrations on in-process Postgres) · extension tests
                     · store zip (only when POSE_SERVER_URL is set) · Docker image smoke test

tag vX.Y.Z ──────── Release (.github/workflows/release.yml)
                     verify tag == manifest version and POSE_SERVER_URL is set → CI (builds the zip)
                     → GitHub Release (+ zip) → Chrome Web Store (submit for review)
```

## Running the pose server

Build and run the image anywhere that can serve HTTPS and WebSockets (the extension needs `wss://` for a store build):

```bash
docker build --build-arg VERSION=v0.4.0 -t squat-overflow-pose server
docker run -p 8080:8080 \
  -e FORMCOACH_ALLOWED_ORIGINS='chrome-extension://lpkaoaegdjhciohkfidnmabjigidofnd' \
  -e GOOGLE_CLIENT_ID='<the client ID in extension/config.js>' \
  -e DATABASE_URL='postgres://…' \
  -e AUTH_JWT_SECRET="$(openssl rand -base64 48)" \
  squat-overflow-pose
```

| Variable | Purpose |
|----------|---------|
| `FORMCOACH_ALLOWED_ORIGINS` | Extension origins allowed to open the WebSocket, comma-separated. Start with the unpacked dev ID; add `chrome-extension://<store-id>` after the first store upload. |
| `GOOGLE_CLIENT_ID` | Google sign-in ID tokens must be issued for this client. Must match `extension/config.js`. |
| `DATABASE_URL` | Postgres 13+ for accounts, the leaderboard and sync. Use `sslmode=require` over the internet. Without it, pose detection works and those endpoints answer 503. |
| `AUTH_JWT_SECRET` | Signs session tokens. Changing it signs every user out; they sign in again with one click. |
| `FORMCOACH_MAX_SESSIONS` | Open pose sessions per process, default `6`. Past it, new clients are closed with code 1013 "server busy" (the extension shows "offline" and the trainer retries). `0` turns the cap off. |

Put TLS in front of the container (a load balancer, reverse proxy or the host's own HTTPS) and check `https://<host>/health` and `https://<host>/privacy`.

Every open break holds one WebSocket and one BlazePose detector, and inference for all sessions in a process shares one Node event loop. `FORMCOACH_MAX_SESSIONS` (default 6) caps sessions per process; add instances past that, and check `latency_ms` in frame results under load before raising it. The pose stream has no login (sign-in only gates the leaderboard), and the origin allowlist keeps web pages out but scripts can fake an Origin. The cap keeps a flood of connections from slowing the sessions already open, but it can't stop that flood from filling the slots; a per-IP connection limit at your host or proxy does that.

Deploy the server before tagging a release whose extension needs new server behaviour. **Keep the WebSocket protocol backward compatible** (add message fields, don't rename or remove them), because store updates wait for review and old extensions keep talking to the new server.

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

"Load unpacked" on `extension/` talks to `ws://127.0.0.1:8765/ws` and `http://127.0.0.1:8765`, the local server from the README. Build a store zip locally with:

```bash
POSE_SERVER_URL=wss://pose.example.com/ws node scripts/build-extension.mjs
```

`POSE_SERVER_URL` is required. The command writes `dist/extension/` (load it unpacked to try the store build) and `dist/squat-overflow-<version>.zip`. The build differs from `extension/` in three ways (the type-checking files, `tsconfig.json`, `*.d.ts` and `node_modules/`, are left out too):
- `config.js` points `POSE_SERVER_URL` at your server and `API_URL` at the same host over `https://`.
- The manifest `key` is removed.
- `tests/` is left out.

Both `wss://<host>` and `https://<host>` must be in the manifest CSP `connect-src`; the build fails if they aren't.

## Database migrations

Schema changes go in a **new** entry at the end of `server/src/db/migrations.ts`. Never edit a migration that has already been released: the server only runs entries it hasn't recorded in `schema_migrations`. Each runs in a transaction when the server starts; an advisory lock keeps two instances from migrating at once. The server tests apply every migration to an in-process Postgres (PGlite) on each PR.

Demo data for the leadliaison.com board: `psql "$DATABASE_URL" -f server/scripts/demo-seed.sql`; remove it with `server/scripts/demo-clear.sql`.

## One-time setup

You need admin access to the GitHub repo and owner access to the Google Cloud and Chrome Web Store accounts, plus a running pose server (above). Do the steps in this order.

### 1. Point the extension at your server
1. Add `wss://<host>` and `https://<host>` to `connect-src` in `extension/manifest.json`.
2. In **Settings → Secrets and variables → Actions → Variables**, set `POSE_SERVER_URL` to `wss://<host>/ws`. CI builds the store zip only while it is set, and releases fail without it.

### 2. GitHub
In **Settings → Environments**, create `production`. Optionally, add yourself as a required reviewer so every store submission waits for a click. Then add:

| Kind | Name | Value |
|------|------|-------|
| Variable | `POSE_SERVER_URL` | `wss://<host>/ws` (repository variable, step 1) |
| Secret | `CWS_SERVICE_ACCOUNT_JSON` | Service-account JSON key from step 4 |
| Variable | `CWS_PUBLISHER_ID` | Developer Dashboard → Publisher → Settings |
| Variable | `CWS_ITEM_ID` | The store item ID (= extension ID) from step 3. While this is empty, releases skip the store job. |

### 3. Chrome Web Store: first upload (manual)
The API can't create a store item, so the first version is uploaded by hand:
1. Register a developer account at https://chrome.google.com/webstore/devconsole (one-time fee).
2. Run `POSE_SERVER_URL=wss://<host>/ws node scripts/build-extension.mjs`, then click **Add new item** and upload `dist/squat-overflow-<version>.zip`.
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
| Pose server | Redeploy the previous image on your host. |
| Database | Add a new migration that reverts the change and deploy it. Don't edit or delete applied migrations. An older server image ignores migrations it doesn't know, so roll the server back only to a release whose code works with the current schema. |
| Extension | Developer Dashboard → the item → roll back to the previous published version (the API has a `rollback` method too), or publish a fixed higher version. |

Camera frames go to whichever server the extension points at. They are processed in memory and never stored. See `server/static/privacy.html`.
