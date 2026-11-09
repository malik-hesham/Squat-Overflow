export const GOOGLE_CLIENT_ID = "977942788346-udafursfj3ns2juas0o7c4knj3pvht3h.apps.googleusercontent.com";
// Default pose server. Unpacked builds use the local server; scripts/build-extension.mjs
// rewrites this line to POSE_SERVER_URL in release zips.
export const POSE_SERVER_URL = "ws://127.0.0.1:8765/ws";
// Sign-in, the leaderboard and sync: the pose server's HTTP API. Unpacked builds use the local
// server; scripts/build-extension.mjs points it at POSE_SERVER_URL's host over https.
export const API_URL = "http://127.0.0.1:8765";
// Cross-device sync (lib/sync.js). While on, the server writes the leaderboard row from synced
// breaks, so the extension no longer PUTs its own score.
export const SYNC_ENABLED = true;
