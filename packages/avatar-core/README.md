# @squat-overflow/avatar-core

The digital human's behaviour, the same on every client: the state machine, the controller that runs
commands, typed events, and body clip blending. It has no platform code (no DOM, Node, React, three or
Expo); time and audio come in through the ports in `@squat-overflow/avatar-types`.

```ts
import { createAvatarController } from '@squat-overflow/avatar-core';

const avatar = createAvatarController({
  clock: { now: () => performance.now() },
  audio, // an AudioPort: Web Audio on the web, expo-audio on mobile
  clips: manifest.animations, // the model's clips; idle is required
  reportError: console.error, // errors thrown by event listeners
});

avatar.on('stateChanged', ({ from, to }) => console.log(from, '→', to));
const outcome = await avatar.execute({ type: 'speak', speech }); // 'completed' | 'interrupted'

// The renderer, once per displayed frame:
const frame = avatar.frame(); // clip weights now; face, eyes and visemes from Phases 4 and 5
```

Rules, event order and what's not built yet: [docs/digital-human/architecture.md](../../docs/digital-human/architecture.md),
section 4 and the Phase 2 record. `setGaze` and `setExpression` throw until Phase 4.

```bash
pnpm --filter @squat-overflow/avatar-core test
```
