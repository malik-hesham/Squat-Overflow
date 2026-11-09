// Meme clips and voice cues for breaks. The turn-taking between clips is the
// extension's (createMemePlayer in extension/lib/memes.js); only playback differs.
import { createAudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';

import { MEME_ASSETS } from './memeAssets';
import { createMemePlayer } from './shared';
import { getMemeTurns, setMemeTurns } from './store';

const MAX_CLIP_MS = 15_000; // never let a stuck clip hold up the voice cues

// Resolves when the clip ends, or right away if it can't play.
function playClip(clip: string, volume = 0.8): Promise<void> {
  const asset = MEME_ASSETS[clip];
  if (asset == null) return Promise.resolve();
  return new Promise((resolve) => {
    let player: ReturnType<typeof createAudioPlayer> | null = null;
    const done = () => {
      clearTimeout(timer);
      sub?.remove();
      player?.remove();
      player = null;
      resolve();
    };
    const timer = setTimeout(done, MAX_CLIP_MS);
    let sub: { remove(): void } | null = null;
    try {
      player = createAudioPlayer(asset);
      player.volume = volume;
      sub = player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) done();
      });
      player.play();
    } catch {
      done();
    }
  });
}

export type Sounds = {
  meme(kind: 'start' | 'done' | 'unscored' | 'reps'): void;
  speak(text: string): void;
  stopSpeech(): void;
};

// Voice cues wait for any meme clip to finish and keep the order they were
// asked in, like the break window's speak().
export async function createSounds(opts: { lang: string; voice: () => boolean; memes: () => boolean }): Promise<Sounds> {
  const player = createMemePlayer(await getMemeTurns(), setMemeTurns, playClip);
  let memeQueue: Promise<unknown> = Promise.resolve();
  let speech: Promise<unknown> = Promise.resolve();
  const memesDone = async () => {
    let clips;
    do await (clips = memeQueue);
    while (clips !== memeQueue);
  };
  return {
    meme(kind) {
      if (opts.memes()) memeQueue = player.play(kind);
    },
    speak(text) {
      if (!opts.voice() || !text) return;
      const prev = speech;
      speech = (async () => {
        await prev;
        await memesDone();
        if (!opts.voice()) return;
        await Speech.stop();
        Speech.speak(text, { rate: 1.05, language: opts.lang === 'ar' ? 'ar-SA' : undefined });
      })();
    },
    stopSpeech() {
      void Speech.stop();
    },
  };
}
