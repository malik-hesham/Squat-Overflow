// avatar-core's controller drives the web renderer: the seam every web client uses.
import { COACH_01 } from '@squat-overflow/avatar-assets';
import modelUrl from '@squat-overflow/avatar-assets/models/coach-01/optimized.glb?url';
import { createAvatarController } from '@squat-overflow/avatar-core';
import { FakeAudio, FakeClock, SeededRandom } from '@squat-overflow/avatar-core/testing';
import type * as THREE from 'three';
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
      random: new SeededRandom(1),
      eyes: COACH_01.eyes,
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

  it("shows core's face and gaze on the real model: a smile, and the eyes turned by their shapes", async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 260;
    document.body.append(canvas);
    const model = await loadAvatarModel(modelUrl, COACH_01);
    const clock = new FakeClock();
    const avatar = createAvatarController({
      clock,
      audio: new FakeAudio(),
      clips: COACH_01.animations,
      random: new SeededRandom(1),
      eyes: COACH_01.eyes,
    });
    view = createAvatarView({
      canvas,
      model,
      frames: avatar,
      framing: 'portrait',
      maxPixelRatio: 1,
    });
    const body = model.root.getObjectByName('Body') as THREE.Mesh;
    const weight = (shape: string) =>
      body.morphTargetInfluences?.[body.morphTargetDictionary?.[shape] ?? -1] ?? 0;

    avatar.setExpression('happy');
    avatar.setGaze([1, 1.69, 0.6]); // well to the avatar's left
    for (let i = 0; i < 60; i++) {
      clock.advance(1000 / 30);
      view.renderOnce();
    }

    expect(weight('mouthSmileLeft')).toBeGreaterThan(0.6);
    expect(weight('eyeLookOutLeft')).toBeGreaterThan(0.2);
    expect(weight('eyeLookInRight')).toBeGreaterThan(0.2);
    expect(weight('eyeLookInLeft')).toBe(0);
    // Looking straight ahead is eye contact: the camera is at the eyes' height.
    expect(view.camera.position.y).toBeCloseTo(COACH_01.eyes.left[1], 6);
    avatar.dispose();
  });
});
