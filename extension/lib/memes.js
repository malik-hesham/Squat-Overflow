// Sound effects for the break window, cut from two videos and numbered by their on-screen label:
//   meme-NN: Egyptian memes, "#NN" in https://www.youtube.com/watch?v=LqTqN77Ggbs
//   sfx-NN:  "Sound NN" in https://www.youtube.com/watch?v=nX0EKK2RnXU
//            1 Surprised, 2 Click, 3 Bone crack, 4 Boom, 5 Throw, 6 Woaaaah, 7 Window, 8 Whoosh,
//            9 Slap, 10 Glitch, 11 Clock ticking, 12 Kids yeyy, 13 Mario coin, 14 Surprised 2,
//            15 Surprised 3, 16 Display digits, 17 Pop, 18 Discord join, 19 Game point, 20 Let's go,
//            21 Wrong answer, 22 Shotgun, 23 Reload, 24 Ding, 25 Help me
const clips = (prefix, ...ns) => ns.map((n) => `${prefix}-${String(n).padStart(2, "0")}`);
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, k) => from + k);

export const MEMES = {
  // "Break now": a new one each break
  start: [...clips("meme", 4, 1, 2, 3, 11, 13, 15, 17, 19, 20, 21, 22, 23), ...clips("sfx", ...range(1, 25))],
  done: clips("meme", 5, 9), // Done, with form scores
  unscored: clips("meme", 7, 8, 10, 12, 14, 18, 24), // Done, nothing scored (no camera, coach offline, no reps)
  reps: clips("meme", 6, 16), // spread over the break, see repMarks()
};

export const memeFile = (clip) => `sounds/memes/${clip}.ogg`;

// The clip whose turn it is in `group`, and the turn after it (wrapping round).
export function takeTurn(group, turn) {
  const i = Number.isInteger(turn) && turn >= 0 ? turn % group.length : 0;
  return { clip: group[i], next: (i + 1) % group.length };
}

// The total-rep counts where the rep clips play: the break's reps split evenly
// between them, e.g. 18 reps and 2 clips -> reps 9 and 18.
export function repMarks(totalReps, clips = MEMES.reps.length) {
  return Array.from({ length: clips }, (_, k) => Math.ceil(((k + 1) * totalReps) / clips));
}

// Resolves when the clip ends, or right away if it can't play.
function playClip(n, volume = 0.8) {
  const audio = new Audio(chrome.runtime.getURL(memeFile(n)));
  audio.volume = volume;
  return new Promise((resolve) => {
    audio.addEventListener("ended", resolve, { once: true });
    audio.addEventListener("error", resolve, { once: true });
    audio.play().catch(resolve);
  });
}

// Plays each group's clips in turn, one clip at a time. `turns` ({ group: index }) is
// where each group left off in earlier breaks; `saveTurns` stores it after every pick.
export function createMemePlayer(turns, saveTurns, play = playClip) {
  const at = { ...turns };
  let queue = Promise.resolve();
  return {
    // Queues the next clip of MEMES[kind]; resolves once it (and anything queued before it) has played.
    play(kind) {
      const { clip, next } = takeTurn(MEMES[kind], at[kind]);
      at[kind] = next;
      saveTurns({ ...at });
      queue = queue.then(() => play(clip));
      return queue;
    },
  };
}
