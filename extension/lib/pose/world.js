/**
 * World-landmark alignment (port of `align_world_y` in server/pose_engine.py).
 *
 * Call this on MediaPipe's raw world landmarks before passing them to
 * `Session.process`.
 */
function mean(xs) {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Population standard deviation (numpy's default, ddof=0). */
function std(xs, m) {
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / xs.length);
}

/**
 * Make world y grow downwards like image y, so "up" is -y in both spaces.
 *
 * MediaPipe's world axes follow the image, but the angle helpers depend on
 * that, so we check it: if world y runs opposite to image y across the body,
 * flip it. Returns `world` itself when nothing needs flipping.
 * @param {readonly import("./geometry.js").Landmark[]} landmarks
 * @param {readonly import("./geometry.js").WorldLandmark[]} world
 * @returns {readonly import("./geometry.js").WorldLandmark[]}
 */
export function alignWorldY(landmarks, world) {
  const imgY = landmarks.map((lm) => Number(lm[1]));
  const wY = world.map((p) => Number(p[1]));
  const mi = mean(imgY);
  const mw = mean(wY);
  if (std(imgY, mi) < 1e-9 || std(wY, mw) < 1e-9) return world;
  // Only the sign of the correlation matters, and that is the sign of the covariance.
  let cov = 0;
  for (let i = 0; i < imgY.length; i++) cov += (imgY[i] - mi) * (wY[i] - mw);
  if (cov < 0) return world.map((p) => [p[0], -p[1], p[2]]);
  return world;
}
