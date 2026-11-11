// ---------------------------------------------------------------------------
// Demo videos
// ---------------------------------------------------------------------------
// A move can have a demo video: a short, silent MP4 of a person doing it, which the API server
// (server/) serves from server/demos/. The break window, the Practice page, the desktop app and the
// phone show the drawn figure (demo-model.js) first, and switch to the video once it plays. With no
// server (a local-only build), no video for the move, or no network, the figure stays. The video is
// asked for only when the user opens the demo, and the request carries no account details.

/**
 * Where the move's demo video would be, or null when there is no server to ask.
 * @param {string} apiUrl the API server's origin (config.js's API_URL), "" for none
 * @param {string} key
 * @returns {string | null}
 */
export function demoVideoUrl(apiUrl, key) {
  return apiUrl ? `${apiUrl}/demos/${encodeURIComponent(key)}.mp4` : null;
}
