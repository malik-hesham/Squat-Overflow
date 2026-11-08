// Development stand-in for the camera on simulators and emulators, which have
// no front camera: it plays a believable rep every couple of seconds so the
// break flow (reps, form scores, XP, summary) can be exercised end to end.
// Only used in __DEV__ builds, and the break screen says when it's on.
import type { FrameResult } from './types';

const SCORES = [92, 78, 100, 64, 88, 100, 85, 71];
const REP_MS = 1800;

export function startSimulatedCoach(exercise: () => string, onFrame: (msg: FrameResult) => void): () => void {
  let reps = 0;
  let current = exercise();
  let k = 0;
  const id = setInterval(() => {
    if (exercise() !== current) {
      current = exercise();
      reps = 0;
    }
    reps += 1;
    const score = SCORES[k++ % SCORES.length];
    const rushed = score < 70;
    onFrame({
      exercise: current,
      stage: 'rest',
      feedback: [],
      rep_event: {
        score,
        partial: false,
        issues: rushed ? ['too_fast'] : [],
        issue_text: rushed ? ['Slow down and control the movement'] : [],
      },
      summary: { reps },
      landmarks: null,
    });
  }, REP_MS);
  return () => clearInterval(id);
}
