# @squat-overflow/avatar-core

The digital human's behaviour, the same on every client: the state machine, the controller that runs
commands, typed events, body clip blending, and the face, eye and procedural layers (expressions,
blinking, gaze with eye-head coordination, breathing, head drift, postures, nods). It has no platform
code (no DOM, Node, React, three or Expo); time, randomness and audio come in through the ports in
`@squat-overflow/avatar-types`.

```ts
import { createAvatarController } from '@squat-overflow/avatar-core';

const avatar = createAvatarController({
  clock: { now: () => performance.now() },
  audio, // an AudioPort: Web Audio on the web, expo-audio on mobile
  clips: manifest.animations, // the model's clips; idle is required
  random: { next: () => Math.random() }, // blinks, glances, breaths; seeded in tests
  eyes: manifest.eyes, // where the model's eyes are; setGaze aims from here
  reportError: console.error, // errors thrown by event listeners
});

avatar.on('stateChanged', ({ from, to }) => console.log(from, '→', to));
const outcome = await avatar.execute({ type: 'speak', speech }); // 'completed' | 'interrupted'
avatar.setExpression('happy'); // on top of the state's own face; 'neutral' clears it
avatar.setGaze([0.3, 1.6, 1]); // look at a point in avatar space (metres); null gives it back

// The renderer, once per displayed frame:
const frame = avatar.frame(); // clips, face shapes, head, neck, eyes, breath (visemes in Phase 5)
```

The layers are exported too (`FacialController`, `EyeController`, `ProceduralAnimation`), with their
numbers (`BLINK_INTERVAL_MS`, `EYE_RANGE`, `BREATH_MS`, …). `@squat-overflow/avatar-core/testing` has a
fake clock and audio and `SeededRandom`.

Rules, priorities, event order and the numbers:
[docs/digital-human/architecture.md](../../docs/digital-human/architecture.md), section 4 and the Phase 4
record.

```bash
pnpm --filter @squat-overflow/avatar-core test
```
