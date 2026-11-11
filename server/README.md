# API server

Optional Google sign-in, the team leaderboard and cross-device sync for the Squat Overflow clients. NestJS on Node, with Postgres for accounts, scores and synced breaks.

Breaks don't need it. Pose detection, rep counting and form scoring run on each device (`extension/lib/pose`, shared with mobile), so camera frames never reach this server. The clients only call it while the user is signed in; signed out, everything stays on the device.

Needs Node 24.9+: NestJS 12 ships as ESM, and this CommonJS build loads it through `require(esm)`, which Jest supports from Node 24.9.

```bash
cd server
npm install
npm run start:dev      # builds, then listens on http://127.0.0.1:8765
npm test               # unit, Postgres (in-process PGlite) and end-to-end HTTP tests
```

Routes:

| Route | |
|---|---|
| `GET /health` | `{ ok, version }` |
| `GET /privacy` | The store's privacy policy page |
| `GET /auth/mobile-callback` | Google's redirect target for the mobile sign-in; relays the result to `squatoverflow://auth` |
| `POST /auth/google` `{id_token, nonce}` | Exchange the extension's Google ID token (+ the raw nonce whose SHA-256 Google signed) for a session |
| `POST /auth/refresh` `{refresh_token}` | New session; the refresh token is single-use |
| `GET /leaderboard?period=week\|all` | Bearer token. My company's board: top 10, plus my row if I'm lower |
| `PUT /leaderboard/me` `{name, xp, level, streak, weekXp, week, avatar}` | Bearer token, work email. Upserts my score |
| `DELETE /leaderboard/me` | Bearer token. Leaves the board |
| `POST /sync/breaks` `{events}` | Bearer token. Uploads finished breaks; ids make a retry safe |
| `GET /sync/breaks?since=&limit=` | Bearer token. Breaks from every device after a cursor |
| `GET /me/profile` | Bearer token. XP, level, streak and today's breaks, derived from all synced breaks |
| `GET /me/settings`, `PATCH /me/settings` | Bearer token. Shared settings, merged per field |
| `PUT /me/progress` | Bearer token. Badges and challenges, last write wins |
| `GET /demos/<move>.mp4` | None. An exercise's demo video from `server/demos/` (byte ranges, cached a day); 404 when the move has none. Made by `extension/scripts/make-demo-video.mjs` |

The company is the domain of the signed-in Google email. Personal providers (gmail.com, outlook.com, …) can sign in but get an empty board. Sessions have the same JSON shape Supabase Auth used to return: an HS256 access token (1 h) and a random refresh token (60 days, stored hashed, rotated on every refresh). Without `DATABASE_URL`, `/health`, `/privacy` and the callback page work and the auth, leaderboard and sync routes answer 503.

Environment variables:

| Variable | Default | |
|---|---|---|
| `FORMCOACH_PORT` | `8765` (`8080` in Docker) | |
| `FORMCOACH_HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | |
| `FORMCOACH_ALLOWED_ORIGINS` | unset | Comma-separated exact origins allowed by CORS; replaces the extension + loopback default |
| `FORMCOACH_VERSION` | `dev` | Set from the Docker `VERSION` build arg |
| `FORMCOACH_DEMOS_DIR` | `server/demos` | Folder of exercise demo videos for `GET /demos/<move>.mp4` |
| `DATABASE_URL` | unset | Postgres for accounts and the leaderboard; migrations run at startup |
| `AUTH_JWT_SECRET` | — | Required with `DATABASE_URL`; at least 32 characters. Signs session tokens |
| `GOOGLE_CLIENT_ID` | — | Required with `DATABASE_URL`; the OAuth client in `extension/config.js` |

## Layout

| File | |
|---|---|
| `src/main.ts` | Bootstrap, CORS |
| `src/app.controller.ts` | `/health`, `/privacy`, `/auth/mobile-callback` |
| `src/config.ts` | Version, Origin allowlist (CORS) |
| `src/auth/` | Google ID-token check, sessions (access + refresh tokens), `BearerGuard`, `/auth/*` |
| `src/leaderboard/` | Score validation, company-from-email, the board query, `/leaderboard` |
| `src/sync/` | Break events, the profile derived from them, per-field settings merge, `/sync/*` and `/me/*` |
| `src/db/` | Postgres pool, migrations (`migrations.ts`) applied at startup under an advisory lock |
| `scripts/demo-seed.sql`, `demo-clear.sql` | Demo players for the leadliaison.com board |
