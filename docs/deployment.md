# Deployment and releases

Squat Overflow has three parts to ship. One version tag ships all three.

| Part | Where it runs | Shipped by |
|------|---------------|------------|
| Pose server (`server/`) | Fly.io app `squat-overflow-pose`, Frankfurt (`fra`) | `flyctl deploy` in the release workflow |
| Leaderboard database (`supabase/migrations/`) | Supabase project `hysvvrdopodlqvuxnvco` | `supabase db push` in the release workflow |
| Extension (`extension/`) | A zip on each GitHub Release, installed with "Load unpacked" | `scripts/build-extension.mjs` in CI; attached by the release workflow |

```
PR / push to main ── CI (.github/workflows/ci.yml)
                     server tests · extension tests + release zip · Docker image smoke test · migrations apply

tag vX.Y.Z ──────── Release (.github/workflows/release.yml)
                     verify tag == manifest version → CI → supabase db push → fly deploy
                     → /health reports vX.Y.Z → GitHub Release with squat-overflow.zip + install notes
```

## Releasing a version

1. In a PR, bump `"version"` in `extension/manifest.json` (semver). Merge the PR.
2. Tag the merge commit on `main` and push the tag:
   ```bash
   git checkout main && git pull
   git tag v0.4.0
   git push origin v0.4.0
   ```
3. Watch **Actions → Release**. The `production` environment jobs run in order:
   - The DB migrations run.
   - The Fly deploy runs and is checked: it waits until `https://squat-overflow-pose.fly.dev/health` reports the new `version`.
   - The GitHub Release is created. Its notes start with the install and update steps from `.github/release-notes.md`, followed by notes generated from merged PRs. It attaches `squat-overflow-<version>.zip` and the same file as `squat-overflow.zip`.

If a job fails, fix the cause on `main`, delete the tag (`git push --delete origin vX.Y.Z && git tag -d vX.Y.Z`), and tag again. Every step is safe to re-run:
- Migrations already applied are skipped.
- Fly re-deploys the same image.
- The release step attaches the zips to an existing release instead of failing.

People update the extension whenever they get to it, so the new server runs alongside older extension versions. **Keep the pose server's WebSocket protocol backward compatible**: add message fields, don't rename or remove them.

## Installing and updating the extension

Send people the link to the latest zip:
`https://github.com/malik-hesham/Squat-Overflow/releases/latest/download/squat-overflow.zip`. The steps are in every release's notes:

- **Install:** unzip it, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `squat-overflow` folder.
- **Update:** replace the folder's contents with the new zip's, then click reload on the extension. **Remove** would delete the person's local XP, streak and badges.

Every release zip keeps the manifest `key`, so every install has the extension ID `lpkaoaegdjhciohkfidnmabjigidofnd`, the same as the dev folder. The pose server's origin allowlist (`server/fly.toml`) is set to that ID, and Google sign-in already works with it in the dev folder.

**Who can download:** the repo is private, so release downloads work only for people with access to it. Before sharing the link, either add colleagues as collaborators or make the repository public. That's the repo owner's call.

## Local development (unchanged)

"Load unpacked" on `extension/` still talks to `ws://127.0.0.1:8765/ws`, the local server from the README. Only release zips point at Fly. Build a release zip locally with:

```bash
node scripts/build-extension.mjs
```

The command writes `dist/squat-overflow/` (load it unpacked to try the release build) and `dist/squat-overflow-<version>.zip`. The build differs from `extension/` in two ways:
- `config.js` points at `wss://squat-overflow-pose.fly.dev/ws`.
- `tests/` and `package.json` are left out.

To point the build at another server, set `POSE_SERVER_URL=wss://…/ws`. That server's origin must also be in the manifest CSP `connect-src`; the build fails if it isn't.

## Database migrations

Schema changes go in a **new** file, `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`. Never edit a migration that has already been released: production only runs files it hasn't recorded yet. Make new SQL safe to re-run (`if not exists`, `create or replace`) where you can. CI applies every migration to a throwaway Postgres (`supabase db start`) on each PR.

## One-time setup

Only the GitHub repo owner can add the secrets: on a repo owned by a personal account, collaborators can't. Fly and Supabase need owner access on those accounts.

### 1. Fly.io (pose server). Done.
The app `squat-overflow-pose` exists in Abdelfattah's Fly org, and a deploy token for CI has been created. To set it up again elsewhere:
1. Install `flyctl` and sign in (`fly auth login`).
2. Run `fly apps create <name>`. If the name isn't `squat-overflow-pose`, replace that name everywhere:
   - `server/fly.toml`
   - the `connect-src` CSP in `extension/manifest.json`
   - `DEFAULT_SERVER_URL` in `scripts/build-extension.mjs`
   - the `url:` in `.github/workflows/release.yml`
   - `server/static/privacy.html`
3. Create a deploy token: `fly tokens create deploy -a <name> -x 999999h`. Keep the whole value, including the `FlyV1 ` prefix.
4. Optionally, deploy once by hand: `fly deploy --build-arg VERSION=manual` in `server/`, then open `https://<name>.fly.dev/health`.

### 2. Supabase (leaderboard)
1. The project owner creates an access token at https://supabase.com/dashboard/account/tokens. A token can reach every project on its account, so use one created only for CI. Also look up the database password (Project Settings → Database).
2. Production got the leaderboard schema by hand, pasted into the SQL Editor before migrations existed. **Don't** mark `20261107000000_leaderboard.sql` as applied. Let the first release run it: every statement is safe to re-run, and the run brings production up to the repo's schema even if a hand-pasted change was missed. It runs in one transaction. To preview it:
   ```bash
   npx supabase@2.122.1 link --project-ref hysvvrdopodlqvuxnvco
   npx supabase@2.122.1 db push --dry-run
   ```
3. Check that `major_version` in `supabase/config.toml` matches `SHOW server_version;` in the SQL Editor.

### 3. GitHub
In **Settings → Environments**, create `production`. Optionally, add a required reviewer so every release waits for a click. Then add:

| Kind | Name | Value |
|------|------|-------|
| Secret | `FLY_API_TOKEN` | Fly deploy token from step 1 |
| Secret | `SUPABASE_ACCESS_TOKEN` | Supabase access token from step 2 |
| Secret | `SUPABASE_DB_PASSWORD` | Database password from step 2 |
| Variable | `SUPABASE_PROJECT_REF` | `hysvvrdopodlqvuxnvco` |

## Rollback

| Part | How |
|------|-----|
| Pose server | `fly releases -a squat-overflow-pose`, then `fly deploy -a squat-overflow-pose --image <image from a previous release>` |
| Database | Add a new migration that reverts the change. Don't edit or delete applied migrations. |
| Extension | Point people at an earlier release's zip, or ship a fixed higher version. The "latest" link follows the newest release; to make an older release "Latest", edit it on GitHub. |

## Capacity and limits

- Every open break holds one WebSocket and one MediaPipe engine. `fly.toml` limits each Machine to 6 sessions (`hard_limit`) and starts a second Machine past 4 (`soft_limit`). The first deploy creates 2 Machines. Warm frames take about 18 ms of server time each.
- To scale, raise `fly scale count`, or the limits after checking `latency_ms` in frame results under load.
- The pose server has no login. The Origin allowlist keeps web pages out, but scripts can fake an Origin, so the Fly connection limit is what bounds abuse.
- Camera frames go to Fly.io in Frankfurt. They are processed in memory and never stored. See `server/static/privacy.html`, served at `/privacy`.
