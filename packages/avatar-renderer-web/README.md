# @squat-overflow/avatar-renderer-web

Draws the digital human with three.js in browsers and webviews (the extension's pages, and so the
desktop app). No UI framework: the extension is plain JavaScript.

```ts
import { COACH_01 } from '@squat-overflow/avatar-assets';
import modelUrl from '@squat-overflow/avatar-assets/models/coach-01/optimized.glb?url';
import { createAvatarController } from '@squat-overflow/avatar-core';
import { createAvatarView, loadAvatarModel } from '@squat-overflow/avatar-renderer-web';

const model = await loadAvatarModel(modelUrl, COACH_01);
const avatar = createAvatarController({
  clock: performance,
  audio,
  clips: COACH_01.animations,
  random: { next: () => Math.random() },
  eyes: COACH_01.eyes,
});
const view = createAvatarView({ canvas, model, frames: avatar, framing: 'portrait' });
view.start(); // draws every animation frame; pauses by itself while the page is hidden
// later: view.dispose() frees the model, the environment map and the WebGL context
```

- `loadAvatarModel` (GLBLoader): loads a profile's GLB (meshopt geometry; the decoder runs on the main
  thread, no worker, so the extension's CSP allows it), softens cutout edges with alpha-to-coverage.
- `createAvatarRig` (WebAnimationAdapter): applies avatar-core's `AvatarFrame` each frame: ARKit
  shapes and visemes through the manifest's names, clip weights and times, head, neck and chest turns
  on top of the clips, and gaze (eye bones, or the `eyeLook*` shapes when the model has none).
- `createAvatarView` (AvatarScene, CameraController, LightingController): the canvas, a soft studio
  light rig, portrait or full-body framing, the render loop. In a portrait the camera is at the eyes'
  height, where avatar-core puts the user, so the avatar's eye contact meets it. `view.camera` turns a
  pointer into a `setGaze` point (the preview page shows how).

## React

`@squat-overflow/avatar-renderer-web/react` wraps the same pieces for React apps (React Three Fiber;
React 19 and R3F 9 are optional peer dependencies, so the vanilla entry doesn't pull them in):

```tsx
import {
  AvatarScene,
  HumanAvatar,
  useAvatarModel,
  useAvatarState,
} from '@squat-overflow/avatar-renderer-web/react';

function Assistant({ avatar }: { avatar: CoreAvatar }) {
  const model = useAvatarModel(modelUrl, COACH_01); // null until loaded; freed on unmount
  const state = useAvatarState(avatar); // 'idle', 'listening', ...
  return (
    <>
      <p>{state}</p>
      <AvatarScene framing="portrait">
        {model ? <HumanAvatar model={model} frames={avatar} /> : null}
      </AvatarScene>
    </>
  );
}
```

`AvatarScene` uses the vanilla view's light rig and framing and stops its loop while the page is hidden.
No Zustand: the controller already holds the state, and `useAvatarState` subscribes to it.

## Preview page

```bash
pnpm --filter @squat-overflow/avatar-renderer-web dev
```

Options: `?profile=high|optimized`, `?framing=portrait|full`, `?measure=300` (times frames; see
[docs/digital-human/performance.md](../../docs/digital-human/performance.md)). The buttons change the
state, "Face" calls `setExpression`, and "Look at the pointer" aims `setGaze` at the pointer. Speech
comes with Phase 5.

## Tests

`pnpm test` runs the adapter in Node and the loader and view in Chromium (vitest browser mode, software
WebGL). Locally, if Playwright's own Chromium isn't installed, point `CHROMIUM_PATH` at a Chromium or
Chrome binary; CI runs `playwright install --with-deps chromium`.
