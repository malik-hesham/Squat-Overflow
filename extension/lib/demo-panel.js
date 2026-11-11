// ---------------------------------------------------------------------------
// The exercise demo panel
// ---------------------------------------------------------------------------
// What the break window and the Practice page (and the desktop app, which runs those pages as they
// are) show when the user opens a move's demo: the drawn figure at once (demo-player.js, made on the
// device), then the move's demo video in its place once the video can play (demo-video.js, from the
// API server). With no server, no video for the move, or no network, the figure stays.

import { createDemoPlayer } from "./demo-player.js";
import { demoVideoUrl } from "./demo-video.js";

/** HTMLMediaElement.HAVE_FUTURE_DATA: enough is loaded to start playing. */
const CAN_PLAY = 3;

/**
 * @param {{ canvas: HTMLCanvasElement, video: HTMLVideoElement, hint: HTMLElement }} els the
 *   figure's canvas, a muted looping video element, and the "drag to turn" hint under the figure
 * @param {string} apiUrl the API server's origin (config.js's API_URL), "" for none
 */
export function createDemoPanel({ canvas, video, hint }, apiUrl) {
  /** @type {ReturnType<typeof createDemoPlayer> | null} */
  let player = null;
  let key = null;

  /** @param {boolean} on */
  const showVideo = (on) => {
    video.hidden = !on;
    canvas.hidden = hint.hidden = on;
    if (!on) return;
    player?.hide();
    video.play().catch(() => {});
  };
  video.addEventListener("canplay", () => {
    if (key && video.dataset.key === key) showVideo(true);
  });

  return {
    /**
     * Shows a move: its figure, and its video when that can play. The same move keeps playing.
     * @param {string} next
     * @param {{ label: string, clipLabel: string }} labels what a screen reader says for each
     */
    show(next, { label, clipLabel }) {
      key = next;
      canvas.setAttribute("aria-label", label);
      video.setAttribute("aria-label", clipLabel);
      const src = demoVideoUrl(apiUrl, next);
      if (src && video.dataset.key === next && video.readyState >= CAN_PLAY) return showVideo(true);
      showVideo(false);
      player ??= createDemoPlayer(canvas);
      player.show(next);
      if (src && video.dataset.key !== next) {
        video.dataset.key = next; // a move whose video failed (none, or offline) isn't asked for again
        video.src = src;
      }
    },
    hide() {
      key = null;
      player?.hide();
      video.pause();
    },
  };
}
