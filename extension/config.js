export const GOOGLE_CLIENT_ID = "977942788346-udafursfj3ns2juas0o7c4knj3pvht3h.apps.googleusercontent.com";
// The optional API server (server/): Google sign-in, the team leaderboard, cross-device sync and the
// exercise demo videos. Breaks never need it: the pose model runs in the extension (lib/pose), and a
// demo shows the drawn figure until its video plays. Unpacked builds use a local server;
// scripts/build-extension.mjs sets this to API_URL in release zips, or "" for a local-only build,
// and with "" the extension makes no requests of its own.
export const API_URL = "http://127.0.0.1:8765";
// Cross-device sync (lib/sync.js). While on, the server writes the leaderboard row from synced
// breaks, so the extension no longer PUTs its own score.
export const SYNC_ENABLED = true;
