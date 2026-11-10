// A page to look at the avatar: `pnpm --filter @squat-overflow/avatar-renderer-web dev`.
// ?profile=high|optimized, ?framing=portrait|full, ?measure=<frames> times frames (see README).
// Face expressions, gaze and blinking come with Phase 4 and speech with Phase 5, so for now the
// buttons change the state and the body clip only.
import { COACH_01 } from '@squat-overflow/avatar-assets';
import highUrl from '@squat-overflow/avatar-assets/models/coach-01/high.glb?url';
import optimizedUrl from '@squat-overflow/avatar-assets/models/coach-01/optimized.glb?url';
import { createAvatarController } from '@squat-overflow/avatar-core';
import type { AvatarCommand, AudioPort, Reaction } from '@squat-overflow/avatar-types';
import { createAvatarView, loadAvatarModel, type Framing } from '../src/index.ts';

const params = new URLSearchParams(location.search);
const profile = params.get('profile') === 'high' ? 'high' : 'optimized';
const framing: Framing = params.get('framing') === 'full' ? 'full' : 'portrait';
const canvas = document.querySelector('canvas');
const state = document.querySelector('#state');
if (!canvas || !state) throw new Error('preview page is missing its canvas');

const noSpeech: AudioPort = {
  play() {
    throw new Error('speech comes with Phase 5');
  },
};

const model = await loadAvatarModel(profile === 'high' ? highUrl : optimizedUrl, COACH_01);
const avatar = createAvatarController({
  clock: { now: () => performance.now() },
  audio: noSpeech,
  clips: COACH_01.animations,
  reportError: (error) => {
    console.error(error);
  },
});
const view = createAvatarView({ canvas, model, frames: avatar, framing });
const fit = () => {
  view.resize(canvas.clientWidth, canvas.clientHeight);
};
new ResizeObserver(fit).observe(canvas);
fit();

const show = () => {
  state.textContent = `${COACH_01.name} · ${profile} · ${avatar.state}`;
};
avatar.on('stateChanged', show);
show();

for (const button of document.querySelectorAll<HTMLButtonElement>('button')) {
  button.addEventListener('click', () => {
    const { command, react } = button.dataset;
    const run: AvatarCommand = react
      ? { type: 'react', reaction: react as Reaction }
      : { type: command as 'idle' | 'listen' | 'think' };
    void avatar.execute(run);
  });
}

const measure = Number(params.get('measure') ?? 0);
if (measure > 0) {
  // Frame cost: pose + draw, then read one pixel back, which makes the browser wait for the GPU to
  // finish the frame (gl.finish() doesn't, in Chrome).
  const gl = view.renderer.getContext();
  const pixel = new Uint8Array(4);
  const draw = () => {
    view.renderOnce();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  };
  for (let i = 0; i < 30; i++) draw(); // warm up shaders and uploads
  const costs: number[] = [];
  for (let i = 0; i < measure; i++) {
    const start = performance.now();
    draw();
    costs.push(performance.now() - start);
  }
  costs.sort((a, b) => a - b);
  const at = (q: number) => costs[Math.min(costs.length - 1, Math.floor(q * costs.length))] ?? 0;
  // Frames actually shown in 3 s of the normal loop (capped by the display's refresh rate).
  view.start();
  let shown = 0;
  const counting = (time: number, startedAt: number) => {
    shown++;
    if (time - startedAt < 3000) {
      requestAnimationFrame((t) => {
        counting(t, startedAt);
      });
    } else {
      finish(shown / ((time - startedAt) / 1000));
    }
  };
  requestAnimationFrame((t) => {
    counting(t, t);
  });
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const finish = (fps: number) => {
    const result = {
      profile,
      framing,
      pixels: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      gpu: debug ? (gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string) : 'unknown',
      triangles: view.renderer.info.render.triangles,
      frameMedianMs: at(0.5),
      frameP95Ms: at(0.95),
      loopFps: Math.round(fps),
    };
    Object.assign(globalThis, { measured: result });
    state.textContent = JSON.stringify(result);
  };
} else {
  view.start();
}
