// The React components in Chromium, with the real model file.
import { COACH_01 } from '@squat-overflow/avatar-assets';
import modelUrl from '@squat-overflow/avatar-assets/models/coach-01/optimized.glb?url';
import { createAvatarController } from '@squat-overflow/avatar-core';
import { FakeAudio } from '@squat-overflow/avatar-core/testing';
import type { AvatarFrame, AvatarFrameSource } from '@squat-overflow/avatar-types';
import { useThree } from '@react-three/fiber';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { LoadedAvatarModel } from '../loader.ts';
import { AvatarScene, HumanAvatar, useAvatarModel, useAvatarState } from './index.ts';

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

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function mount(node: ReactNode) {
  const host = document.createElement('div');
  host.style.width = '240px';
  host.style.height = '320px';
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
}

const waitFor = async (check: () => boolean, ms = 30000) => {
  const start = performance.now();
  while (!check()) {
    if (performance.now() - start > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 30));
  }
};

/** Puts the R3F renderer and the loaded model where the test can see them. */
function Seen({ into }: { into: { gl?: THREE.WebGLRenderer } }) {
  into.gl = useThree((state) => state.gl);
  return null;
}

function Avatar({
  frames,
  seen,
  onModel,
}: {
  frames: AvatarFrameSource;
  seen: { gl?: THREE.WebGLRenderer };
  onModel?: (m: LoadedAvatarModel) => void;
}) {
  const model = useAvatarModel(modelUrl, COACH_01);
  if (model) onModel?.(model);
  return (
    <AvatarScene framing="full">
      <Seen into={seen} />
      {model ? <HumanAvatar model={model} frames={frames} /> : null}
    </AvatarScene>
  );
}

describe('AvatarScene + HumanAvatar', () => {
  it('draws the whole model and poses it from the frame source on every frame', async () => {
    const frames = new Frames();
    frames.next = { ...REST, blendshapes: { jawOpen: 1 } };
    const seen: { gl?: THREE.WebGLRenderer } = {};
    let model: LoadedAvatarModel | undefined;
    mount(<Avatar frames={frames} seen={seen} onModel={(m) => (model = m)} />);

    await waitFor(() => frames.calls >= 5);

    expect(seen.gl?.info.render.triangles).toBe(COACH_01.profiles.optimized.triangles);
    const body = model?.root.getObjectByName('Body') as THREE.Mesh | undefined;
    expect(body?.morphTargetInfluences?.[body.morphTargetDictionary?.['jawOpen'] ?? -1]).toBe(1);
  });

  it('stops asking for frames while the page is hidden, and starts again when it is shown', async () => {
    const frames = new Frames();
    mount(<Avatar frames={frames} seen={{}} />);
    await waitFor(() => frames.calls >= 3);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await new Promise((r) => setTimeout(r, 100));
    const whileHidden = frames.calls;
    await new Promise((r) => setTimeout(r, 200));
    expect(frames.calls).toBe(whileHidden);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => frames.calls > whileHidden + 2);
  });

  it("frees every geometry and texture of the model when it's unmounted", async () => {
    const frames = new Frames();
    let model: LoadedAvatarModel | undefined;
    mount(<Avatar frames={frames} seen={{}} onModel={(m) => (model = m)} />);
    await waitFor(() => frames.calls >= 2 && model !== undefined);
    const resources: { dispose(): void; addEventListener(t: 'dispose', f: () => void): void }[] =
      [];
    model?.root.traverse((o) => {
      if ((o as Partial<THREE.Mesh>).isMesh !== true) return;
      const mesh = o as THREE.Mesh;
      resources.push(mesh.geometry);
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (material.map) resources.push(material.map);
    });
    const freed = new Set<unknown>();
    for (const r of resources) r.addEventListener('dispose', () => freed.add(r));

    act(() => root?.unmount());
    root = undefined;

    expect(resources.length).toBeGreaterThan(5);
    expect(freed.size).toBe(new Set(resources).size); // a texture used twice is freed (at least) once
  });
});

describe('useAvatarState', () => {
  it("follows the controller's state", async () => {
    const avatar = createAvatarController({
      clock: { now: () => performance.now() },
      audio: new FakeAudio(),
      clips: COACH_01.animations,
    });
    function State() {
      return <p id="state">{useAvatarState(avatar)}</p>;
    }
    mount(<State />);
    expect(document.querySelector('#state')?.textContent).toBe('idle');

    await act(async () => {
      await avatar.execute({ type: 'listen' });
    });

    expect(document.querySelector('#state')?.textContent).toBe('listening');
  });
});
