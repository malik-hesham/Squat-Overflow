// Runs in Chromium (vitest browser mode): the real model file, WebGL, the render loop.
import { COACH_01 } from '@squat-overflow/avatar-assets';
import modelUrl from '@squat-overflow/avatar-assets/models/coach-01/optimized.glb?url';
import type { AvatarFrame, AvatarFrameSource } from '@squat-overflow/avatar-types';
import { afterEach, describe, expect, it } from 'vitest';
import { loadAvatarModel } from './loader.ts';
import { createAvatarView, type AvatarView } from './view.ts';

const STILL = { yaw: 0, pitch: 0, roll: 0 };
const REST: AvatarFrame = {
  blendshapes: {},
  visemes: {},
  head: STILL,
  neck: STILL,
  eyes: { left: { yaw: 0, pitch: 0 }, right: { yaw: 0, pitch: 0 } },
  breath: 0,
  clips: [{ slot: 'idle', weight: 1, timeMs: 2000 }],
};

class Frames implements AvatarFrameSource {
  calls = 0;
  next: AvatarFrame = REST;
  frame(): AvatarFrame {
    this.calls++;
    return this.next;
  }
}

const views: AvatarView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.dispose();
  document.body.replaceChildren();
});

async function setup(framing: 'portrait' | 'full' = 'full') {
  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 320;
  document.body.append(canvas);
  const model = await loadAvatarModel(modelUrl, COACH_01);
  const frames = new Frames();
  const view = createAvatarView({ canvas, model, frames, framing, maxPixelRatio: 1 });
  views.push(view);
  return { canvas, model, frames, view };
}

/** RGBA of the drawing buffer, read straight after a render (before the browser composites it). */
function pixels(view: AvatarView): Uint8Array {
  view.renderOnce();
  const gl = view.renderer.getContext();
  const out = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
  gl.readPixels(
    0,
    0,
    gl.drawingBufferWidth,
    gl.drawingBufferHeight,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    out
  );
  return out;
}
const covered = (rgba: Uint8Array) => rgba.filter((alpha, i) => i % 4 === 3 && alpha > 0).length;
const changed = (a: Uint8Array, b: Uint8Array) => {
  let n = 0;
  const at = (x: Uint8Array, i: number) => x[i] ?? 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(at(a, i) - at(b, i)) + Math.abs(at(a, i + 1) - at(b, i + 1)) > 24) n++;
  }
  return n;
};
const nextFrames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => {
      if (left === 0) resolve();
      else
        requestAnimationFrame(() => {
          step(left - 1);
        });
    };
    step(n);
  });

describe('loadAvatarModel', () => {
  it('loads the model with its idle clip and its face shapes', async () => {
    const model = await loadAvatarModel(modelUrl, COACH_01);

    expect(model.clips.map((c) => c.name)).toContain('idle');
    const body = model.root.getObjectByName('Body') as {
      morphTargetDictionary?: Record<string, number>;
    };
    expect(Object.keys(body.morphTargetDictionary ?? {})).toHaveLength(67);
    model.dispose();
  });
});

describe('createAvatarView', () => {
  it('draws the avatar over a transparent background', async () => {
    const { view } = await setup('full');

    const share = covered(pixels(view)) / (240 * 320);

    expect(share).toBeGreaterThan(0.05); // the figure fills part of the frame...
    expect(share).toBeLessThan(0.6); // ...and the background stays clear
  });

  it('poses the face from the frame source: opening the jaw changes the mouth', async () => {
    const { frames, view } = await setup('portrait');
    const closed = pixels(view);

    frames.next = { ...REST, blendshapes: { jawOpen: 1 } };
    const open = pixels(view);

    expect(changed(closed, open)).toBeGreaterThan(200);
  });

  it('asks the frame source for a frame each animation frame, and pauses while the page is hidden', async () => {
    const { frames, view } = await setup();
    view.start();
    await nextFrames(5);
    expect(frames.calls).toBeGreaterThanOrEqual(3);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const whileHidden = frames.calls;
    await nextFrames(5);
    expect(frames.calls).toBe(whileHidden);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    await nextFrames(5);
    expect(frames.calls).toBeGreaterThan(whileHidden);
  });

  it('frees its GPU memory and stops when disposed', async () => {
    const { frames, view } = await setup();
    view.start();
    await nextFrames(2);
    const info = view.renderer.info.memory;
    expect(info.geometries).toBeGreaterThan(0);

    view.dispose();
    const calls = frames.calls;
    await nextFrames(4);

    expect(frames.calls).toBe(calls);
    expect(info.geometries).toBe(0);
    expect(info.textures).toBe(0);
  });
});
