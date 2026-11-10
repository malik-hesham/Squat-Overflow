// avatar-core's controller drives the web renderer: the seam every web client uses.
import { COACH_01 } from '@squat-overflow/avatar-assets';
import modelUrl from '@squat-overflow/avatar-assets/models/coach-01/optimized.glb?url';
import { createAvatarController } from '@squat-overflow/avatar-core';
import { FakeAudio } from '@squat-overflow/avatar-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createAvatarView, loadAvatarModel, type AvatarView } from './index.ts';

let view: AvatarView | undefined;
afterEach(() => {
  view?.dispose();
  document.body.replaceChildren();
});

describe('avatar-core + web renderer', () => {
  it("renders the controller's frames: the idle clip plays on the model's own clip list", async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 260;
    document.body.append(canvas);
    const model = await loadAvatarModel(modelUrl, COACH_01);
    const avatar = createAvatarController({
      clock: { now: () => performance.now() },
      audio: new FakeAudio(),
      clips: COACH_01.animations,
    });
    view = createAvatarView({ canvas, model, frames: avatar, framing: 'full', maxPixelRatio: 1 });

    view.renderOnce();
    await avatar.execute({ type: 'listen' }); // the model has no listening clip: core falls back to idle
    view.renderOnce();

    expect(avatar.state).toBe('listening');
    expect(avatar.frame().clips.map((c) => c.slot)).toEqual(['idle']);
    expect(view.renderer.info.render.triangles).toBe(COACH_01.profiles.optimized.triangles);
    avatar.dispose();
  });
});
