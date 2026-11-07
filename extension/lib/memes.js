// Egyptian meme sound effects for the break window. Clips are cut from
// https://www.youtube.com/watch?v=LqTqN77Ggbs and numbered by their #label in the video.
export const MEMES = {
  start: [4], // "Break now"
  done: [5, 9], // Done, with form scores
  unscored: [7, 8, 10, 12, 14, 18, 24], // Done, nothing scored (no camera, coach offline, no reps)
  reps: [6, 16], // every REP_MEME_EVERY reps
};

export const REP_MEME_EVERY = 3;

export const memeFile = (n) => `sounds/memes/meme-${String(n).padStart(2, "0")}.ogg`;

// True when the rep count went past a multiple of REP_MEME_EVERY.
export const repMilestone = (was, reps) => Math.floor(reps / REP_MEME_EVERY) > Math.floor(was / REP_MEME_EVERY);

// A random clip from `group`, avoiding `prev` so a clip doesn't play twice in a row.
export function pickMeme(group, prev = 0, rand = Math.random) {
  const pool = group.length > 1 ? group.filter((n) => n !== prev) : group;
  return pool[Math.floor(rand() * pool.length)];
}

let last = 0;

// Plays a random clip from MEMES[kind]. Resolves when it ends, or right away if it can't play.
export function playMeme(kind, volume = 0.8) {
  last = pickMeme(MEMES[kind], last);
  const audio = new Audio(chrome.runtime.getURL(memeFile(last)));
  audio.volume = volume;
  return new Promise((resolve) => {
    audio.addEventListener("ended", resolve, { once: true });
    audio.addEventListener("error", resolve, { once: true });
    audio.play().catch(resolve);
  });
}
