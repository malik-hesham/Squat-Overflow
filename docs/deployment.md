# Deployment and releases

Squat Overflow has three deployable parts. One version tag ships all three.

| Part | Where it runs | Deployed by |
|------|---------------|-------------|
| Pose server (`server/`) | Fly.io app `squat-overflow-pose`, Frankfurt (`fra`) | `flyctl deploy` in the release workflow |
| Leaderboard database (`supabase/migrations/`) | Supabase project `hysvvrdopodlqvuxnvco` | `supabase db push` in the release workflow |
| Extension (`extension/`) | Chrome Web Store | `scripts/publish-cws.mjs` in the release workflow |

```
PR / push to main ── CI (.github/workflows/ci.yml)
                     server tests · extension tests + store zip · Docker image smoke test · migrations apply

tag vX.Y.Z ──────── Release (.github/workflows/release.yml)
                     verify tag == manifest version → CI → supabase db push → fly deploy
                     → /health reports vX.Y.Z → GitHub Release (+ zip) → Chrome Web Store (submit for review)
```

## Releasing a version

1. In a PR, bump `"version"` in `extension/manifest.json`. Use semver; the store rejects a version that isn't higher than the live one. Add a row to the version history in `CHROMEWEBSTORE.md`. Merge the PR.
2. Tag the merge commit on `main` and push the tag:
   ```bash
   git checkout main && git pull
   git tag v0.4.0
   git push origin v0.4.0
   ```
3. Watch **Actions → Release**. The `production` environment jobs run in order:
   - The DB migrations run.
   - The Fly deploy runs and is checked: it waits until `https://squat-overflow-pose.fly.dev/health` reports the new `version`.
   - The GitHub Release is created with notes generated from merged PRs and the store zip attached.
   - The store job uploads the zip and submits it for review. It goes live automatically once Google approves it, usually within a few days.

If a job fails, fix the cause on `main`, delete the tag (`git push --delete origin vX.Y.Z && git tag -d vX.Y.Z`), and tag again. Every step is safe to re-run:
- Migrations already applied are skipped.
- Fly re-deploys the same image.
- The release step attaches the zip to an existing release instead of failing.

The server deploys right away, but the store update waits for review, so for a few days the new server runs alongside the old extension. **Keep the pose server's WebSocket protocol backward compatible**: add message fields, don't rename or remove them.

## Local development (unchanged)

"Load unpacked" on `extension/` still talks to `ws://127.0.0.1:8765/ws`, the local server from the README. Only the store zip points at Fly. Build the store zip locally with:

```bash
node scripts/build-extension.mjs
```

The command writes `dist/extension/` (load it unpacked to try the store build) and `dist/squat-overflow-<version>.zip`. The build differs from `extension/` in three ways:
- `config.js` points at `wss://squat-overflow-pose.fly.dev/ws`.
- The manifest `key` is removed.
- `tests/` is left out.

To point the build at another server, set `POSE_SERVER_URL=wss://…/ws`. That server's origin must also be in the manifest CSP `connect-src`; the build fails if it isn't.

## Database migrations

Schema changes go in a **new** file, `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`. Never edit a migration that has already been released: production only runs files it hasn't recorded yet. Make new SQL safe to re-run (`if not exists`, `create or replace`) where you can. CI applies every migration to a throwaway Postgres (`supabase db start`) on each PR.

## One-time setup

You need admin access to the GitHub repo and owner access to the Fly, Supabase, Google Cloud and Chrome Web Store accounts. Do the steps in this order.

### 1. Fly.io (pose server)
1. Install `flyctl` and sign in (`fly auth login`).
2. In `server/`, run `fly launch --no-deploy --copy-config`. Keep the name `squat-overflow-pose`. If it's taken, choose another and replace `squat-overflow-pose` everywhere:
   - `server/fly.toml`
   - the `connect-src` CSP in `extension/manifest.json`
   - `DEFAULT_SERVER_URL` in `scripts/build-extension.mjs`
   - the `url:` in `.github/workflows/release.yml`
   - `CHROMEWEBSTORE.md`
   - `server/static/privacy.html`
3. Create a deploy token for CI: `fly tokens create deploy -x 999999h`. Copy the whole output, including the `FlyV1 ` prefix.
4. Optionally, deploy once by hand to try it: `fly deploy --build-arg VERSION=manual`, then open `https://squat-overflow-pose.fly.dev/health`.

### 2. Supabase (leaderboard)
1. Create an access token at https://supabase.com/dashboard/account/tokens and look up the database password (Project Settings → Database).
2. Production got the leaderboard schema by hand, pasted into the SQL Editor before migrations existed. **Don't** mark `20261107000000_leaderboard.sql` as applied. Let the first release run it: every statement is safe to re-run, and the run brings production up to the repo's schema even if a hand-pasted change was missed (such as the Google sign-in change to `submit_score`/`leaderboard`). It runs in one transaction. To preview it:
   ```bash
   npx supabase@2.122.1 link --project-ref hysvvrdopodlqvuxnvco
   npx supabase@2.122.1 db push --dry-run
   ```
3. Check that `major_version` in `supabase/config.toml` matches `SHOW server_version;` in the SQL Editor.

### 3. GitHub
In **Settings → Environments**, create `production`. Optionally, add yourself as a required reviewer so every release waits for a click. Then add:

| Kind | Name | Value |
|------|------|-------|
| Secret | `FLY_API_TOKEN` | Fly deploy token from step 1 |
| Secret | `SUPABASE_ACCESS_TOKEN` | Supabase access token |
| Secret | `SUPABASE_DB_PASSWORD` | Database password |
| Secret | `CWS_SERVICE_ACCOUNT_JSON` | Service-account JSON key from step 5 |
| Variable | `SUPABASE_PROJECT_REF` | `hysvvrdopodlqvuxnvco` |
| Variable | `CWS_PUBLISHER_ID` | Developer Dashboard → Publisher → Settings |
| Variable | `CWS_ITEM_ID` | The store item ID (= extension ID) from step 4. While this is empty, releases skip the store job. |

### 4. Chrome Web Store: first upload (manual)
The API can't create a store item, so the first version is uploaded by hand:
1. Register a developer account at https://chrome.google.com/webstore/devconsole (one-time fee).
2. Run `node scripts/build-extension.mjs`, then click **Add new item** and upload `dist/squat-overflow-<version>.zip`.
3. Fill in the **Store listing** and **Privacy** tabs from `CHROMEWEBSTORE.md`. Add screenshots. Replace the placeholder contact email in `server/static/privacy.html` first; the policy URL is `https://squat-overflow-pose.fly.dev/privacy`.
4. Note the **item ID**: it is the store extension ID. Then:
   - Set `CWS_ITEM_ID` (step 3).
   - Add `chrome-extension://<item-id>` to `FORMCOACH_ALLOWED_ORIGINS` in `server/fly.toml`. Keep the dev ID, comma-separated. Deploy it with the next release.
   - In Google Cloud Console → Credentials → the OAuth client from `extension/config.js`, add the redirect URI `https://<item-id>.chromiumapp.org/`. For users outside the test-user list, the `calendar.freebusy` scope may need OAuth consent-screen verification.
5. Submit for review. Later versions go through the release workflow.

### 5. Chrome Web Store API (automated uploads)
1. In a Google Cloud project, enable the **Chrome Web Store API**.
2. Create a service account. It needs no IAM roles. Create a JSON key for it and save the key as `CWS_SERVICE_ACCOUNT_JSON`.
3. In the Developer Dashboard, under **Account**, add the service account's email. Only one service account is allowed per publisher.

## Rollback

| Part | How |
|------|-----|
| Pose server | `fly releases -a squat-overflow-pose`, then `fly deploy -a squat-overflow-pose --image <image from a previous release>` |
| Database | Add a new migration that reverts the change. Don't edit or delete applied migrations. |
| Extension | Developer Dashboard → the item → roll back to the previous published version (the API has a `rollback` method too), or publish a fixed higher version. |

## Capacity and limits

- Every open break holds one WebSocket and one MediaPipe engine. `fly.toml` limits each Machine to 6 sessions (`hard_limit`) and starts a second Machine past 4 (`soft_limit`). The first deploy creates 2 Machines.
- To scale, raise `fly scale count`, or the limits after checking `latency_ms` in frame results under load.
- The pose server has no login. The Origin allowlist keeps web pages out, but scripts can fake an Origin, so the Fly connection limit is what bounds abuse.
- Camera frames go to Fly.io in Frankfurt. They are processed in memory and never stored. See `server/static/privacy.html`.
