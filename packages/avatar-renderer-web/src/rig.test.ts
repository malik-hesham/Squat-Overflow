import {
  ARKIT_BLENDSHAPES,
  VISEMES,
  type ArkitBlendshape,
  type AvatarAssetManifest,
  type AvatarFrame,
  type VisemeId,
} from '@squat-overflow/avatar-types';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BREATH_PITCH_MAX, createAvatarRig, EYE_PITCH_MAX, EYE_YAW_MAX } from './rig.ts';

const arkit = Object.fromEntries(ARKIT_BLENDSHAPES.map((n) => [n, n])) as Record<
  ArkitBlendshape,
  string
>;
const visemes = Object.fromEntries(VISEMES.map((v) => [v, `viseme_${v}`])) as Record<
  VisemeId,
  string
>;
const MANIFEST: AvatarAssetManifest = {
  id: 'test',
  name: 'Test',
  licenses: [],
  profiles: {
    high: { uri: 'h.glb', bytes: 1, sha256: '', triangles: 1 },
    optimized: { uri: 'o.glb', bytes: 1, sha256: '', triangles: 1 },
  },
  morphTargets: { arkit, visemes },
  skeleton: { hips: 'pelvis', spine: 'spine_01', chest: 'spine_03', neck: 'neck_01', head: 'head' },
  animations: {
    idle: { clip: 'idle', durationMs: 4000, loop: true },
    listening: { clip: 'listen_loop', durationMs: 2000, loop: true },
    thinking: { clip: 'think_loop', durationMs: 2000, loop: true },
  },
};

const STILL = { yaw: 0, pitch: 0, roll: 0 };
const REST: AvatarFrame = {
  blendshapes: {},
  visemes: {},
  head: STILL,
  neck: STILL,
  eyes: { left: { yaw: 0, pitch: 0 }, right: { yaw: 0, pitch: 0 } },
  breath: 0,
  clips: [{ slot: 'idle', weight: 1, timeMs: 0 }],
};

/** A tiny rigged "model": pelvis → spine_01 → spine_03 → neck_01 → head, a face and teeth with morphs. */
function makeModel({ eyeBones = false } = {}) {
  const root = new THREE.Group();
  const bone = (name: string, parent: THREE.Object3D | null, y: number) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.y = y;
    (parent ?? root).add(b);
    return b;
  };
  const pelvis = bone('pelvis', null, 1);
  const spine = bone('spine_01', pelvis, 0.1);
  const chest = bone('spine_03', spine, 0.2);
  const neck = bone('neck_01', chest, 0.3);
  const head = bone('head', neck, 0.1);
  const eyes = eyeBones
    ? { left: bone('eye_L', head, 0.05), right: bone('eye_R', head, 0.05) }
    : null;
  const morphMesh = (name: string, morphs: readonly string[]) => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    mesh.name = name;
    mesh.morphTargetDictionary = Object.fromEntries(morphs.map((m, i) => [m, i]));
    mesh.morphTargetInfluences = morphs.map(() => 0.5); // not zero: the rig must clear them
    root.add(mesh);
    return mesh;
  };
  const face = morphMesh('Body', [...ARKIT_BLENDSHAPES, ...VISEMES.map((v) => `viseme_${v}`)]);
  const teeth = morphMesh('Teeth', ['jawOpen', 'viseme_aa']);
  // Clips move chest.position.x so the blend is easy to read: idle x = t (seconds), listening x = 10.
  const clips = [
    new THREE.AnimationClip('idle', 4, [
      new THREE.NumberKeyframeTrack('spine_03.position[x]', [0, 4], [0, 4]),
    ]),
    new THREE.AnimationClip('listen_loop', 2, [
      new THREE.NumberKeyframeTrack('spine_03.position[x]', [0, 2], [10, 10]),
    ]),
    // Thinking turns the head 20° to the avatar's left.
    new THREE.AnimationClip('think_loop', 2, [
      new THREE.QuaternionKeyframeTrack(
        'head.quaternion',
        [0, 2],
        [...yawQ(20).toArray(), ...yawQ(20).toArray()]
      ),
    ]),
  ];
  return { root, clips, chest, neck, head, eyes, face, teeth };
}

function yawQ(degrees: number) {
  return new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    THREE.MathUtils.degToRad(degrees)
  );
}

const influence = (mesh: THREE.Mesh, name: string) =>
  mesh.morphTargetInfluences?.[mesh.morphTargetDictionary?.[name] ?? -1];

describe('createAvatarRig: face shapes', () => {
  it('sets each mapped shape and viseme on every mesh that has it, and clears the ones the frame leaves out', () => {
    const model = makeModel();
    const rig = createAvatarRig({ root: model.root, clips: model.clips, manifest: MANIFEST });

    rig.apply({ ...REST, blendshapes: { jawOpen: 0.6, eyeBlinkLeft: 1 }, visemes: { aa: 0.8 } });

    expect(influence(model.face, 'jawOpen')).toBe(0.6);
    expect(influence(model.teeth, 'jawOpen')).toBe(0.6);
    expect(influence(model.face, 'eyeBlinkLeft')).toBe(1);
    expect(influence(model.face, 'viseme_aa')).toBe(0.8);
    expect(influence(model.teeth, 'viseme_aa')).toBe(0.8);
    expect(influence(model.face, 'mouthSmileLeft')).toBe(0);
    expect(influence(model.face, 'viseme_O')).toBe(0);
  });
});

describe('createAvatarRig: body clips', () => {
  it("blends the clips by the frame's weights, at the frame's times (core keeps clip time)", () => {
    const model = makeModel();
    const rig = createAvatarRig({ root: model.root, clips: model.clips, manifest: MANIFEST });

    rig.apply({ ...REST, clips: [{ slot: 'idle', weight: 1, timeMs: 2500 }] });
    expect(model.chest.position.x).toBeCloseTo(2.5);

    rig.apply({
      ...REST,
      clips: [
        { slot: 'idle', weight: 0.25, timeMs: 1000 },
        { slot: 'listening', weight: 0.75, timeMs: 500 },
      ],
    });
    expect(model.chest.position.x).toBeCloseTo(0.25 * 1 + 0.75 * 10);
  });

  it('ignores a clip slot the model does not have', () => {
    const model = makeModel();
    const rig = createAvatarRig({ root: model.root, clips: model.clips, manifest: MANIFEST });

    rig.apply({
      ...REST,
      clips: [
        { slot: 'idle', weight: 0.5, timeMs: 2000 },
        { slot: 'nod', weight: 0.5, timeMs: 0 },
      ],
    });

    expect(model.chest.position.x).toBeCloseTo(1); // idle alone, half weight, mixed with the rest pose (0)
  });
});

const deg = THREE.MathUtils.degToRad;
const worldQ = (o: THREE.Object3D) => {
  o.updateWorldMatrix(true, false);
  return o.getWorldQuaternion(new THREE.Quaternion());
};
/** The turn between two world orientations, as seen in avatar space (root at identity here). */
const turnBetween = (from: THREE.Quaternion, to: THREE.Quaternion) =>
  to.clone().multiply(from.clone().invert());
const near = (a: THREE.Quaternion, b: THREE.Quaternion) => Math.abs(a.dot(b)) > 0.9999;

describe('createAvatarRig: head and neck', () => {
  function setup(restHead = new THREE.Quaternion()) {
    const model = makeModel();
    model.head.quaternion.copy(restHead); // real models' bones have arbitrary rest orientations
    const rig = createAvatarRig({ root: model.root, clips: model.clips, manifest: MANIFEST });
    rig.apply(REST);
    return { model, rig, still: worldQ(model.head) };
  }
  const odd = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, -1.1, 0.7));

  it.each([
    [
      "yaw turns it to the avatar's left (+X)",
      { yaw: deg(90), pitch: 0, roll: 0 },
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(1, 0, 0),
    ],
    [
      'pitch tips it up',
      { yaw: 0, pitch: deg(90), roll: 0 },
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 1, 0),
    ],
    [
      'roll tilts it to the left shoulder',
      { yaw: 0, pitch: 0, roll: deg(90) },
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(1, 0, 0),
    ],
  ])("%s, whatever the bone's rest orientation", (_name, head, from, to) => {
    const { model, rig, still } = setup(odd);

    rig.apply({ ...REST, head });

    const turn = turnBetween(still, worldQ(model.head));
    const moved = from.clone().applyQuaternion(turn);
    expect(moved.distanceTo(to)).toBeLessThan(1e-6);
  });

  it('does not pile up: the same frame twice gives the same pose, and a still frame puts it back', () => {
    const { model, rig, still } = setup(odd);
    const turned = { ...REST, head: { yaw: deg(30), pitch: deg(10), roll: 0 } };

    rig.apply(turned);
    const once = worldQ(model.head);
    rig.apply(turned);
    expect(near(worldQ(model.head), once)).toBe(true);

    rig.apply(REST);
    expect(near(worldQ(model.head), still)).toBe(true);
  });

  it('adds the neck and head turns, on top of what the clip does', () => {
    const { model, rig, still } = setup();

    rig.apply({
      ...REST,
      clips: [{ slot: 'thinking', weight: 1, timeMs: 0 }], // the clip turns the head 20°
      neck: { yaw: deg(30), pitch: 0, roll: 0 },
      head: { yaw: deg(40), pitch: 0, roll: 0 },
    });

    expect(near(turnBetween(still, worldQ(model.head)), yawQ(90))).toBe(true);
  });
});

describe('createAvatarRig: eyes', () => {
  it('uses the full eyeLook shapes for 30° sideways and 25° up or down', () => {
    expect(EYE_YAW_MAX).toBeCloseTo(deg(30));
    expect(EYE_PITCH_MAX).toBeCloseTo(deg(25));
  });

  it('turns the eyes with the eyeLook shapes when the model has no eye bones', () => {
    const model = makeModel();
    const rig = createAvatarRig({ root: model.root, clips: model.clips, manifest: MANIFEST });

    rig.apply({
      ...REST,
      eyes: {
        left: { yaw: EYE_YAW_MAX / 2, pitch: EYE_PITCH_MAX }, // half way to the avatar's left, fully up
        right: { yaw: -EYE_YAW_MAX, pitch: -2 * EYE_PITCH_MAX }, // fully to its right, down (capped)
      },
    });

    const shape = (name: string) => influence(model.face, name);
    expect([
      shape('eyeLookOutLeft'),
      shape('eyeLookInLeft'),
      shape('eyeLookUpLeft'),
      shape('eyeLookDownLeft'),
    ]).toEqual([0.5, 0, 1, 0]);
    expect([
      shape('eyeLookOutRight'),
      shape('eyeLookInRight'),
      shape('eyeLookUpRight'),
      shape('eyeLookDownRight'),
    ]).toEqual([1, 0, 0, 1]);
  });

  it('adds the gaze to the eye shapes the frame sets, capped at 1', () => {
    const model = makeModel();
    const rig = createAvatarRig({ root: model.root, clips: model.clips, manifest: MANIFEST });

    rig.apply({
      ...REST,
      blendshapes: { eyeLookUpLeft: 0.7, eyeLookInRight: 0.2 },
      eyes: {
        left: { yaw: 0, pitch: EYE_PITCH_MAX / 2 },
        right: { yaw: EYE_YAW_MAX / 2, pitch: 0 },
      },
    });

    expect(influence(model.face, 'eyeLookUpLeft')).toBe(1);
    expect(influence(model.face, 'eyeLookInRight')).toBeCloseTo(0.7);
  });

  it('turns the eye bones instead when the model has them', () => {
    const model = makeModel({ eyeBones: true });
    const manifest = {
      ...MANIFEST,
      skeleton: { ...MANIFEST.skeleton, leftEye: 'eye_L', rightEye: 'eye_R' },
    };
    const rig = createAvatarRig({ root: model.root, clips: model.clips, manifest });
    rig.apply(REST);
    const eyes = model.eyes;
    if (!eyes) throw new Error('the model was made with eye bones');
    const still = worldQ(eyes.left);

    rig.apply({
      ...REST,
      eyes: { left: { yaw: deg(20), pitch: 0 }, right: { yaw: deg(20), pitch: 0 } },
    });

    expect(near(turnBetween(still, worldQ(eyes.left)), yawQ(20))).toBe(true);
    expect(influence(model.face, 'eyeLookOutLeft')).toBe(0);
  });
});

describe('createAvatarRig: breath and viseme mixes', () => {
  it('lifts the chest by up to 1.5° with the breath', () => {
    expect(BREATH_PITCH_MAX).toBeCloseTo(deg(1.5));
    const model = makeModel();
    const rig = createAvatarRig({ root: model.root, clips: model.clips, manifest: MANIFEST });
    rig.apply(REST);
    const out = worldQ(model.chest);

    rig.apply({ ...REST, breath: 1 });
    const pitchUp = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      -BREATH_PITCH_MAX
    );

    expect(near(turnBetween(out, worldQ(model.chest)), pitchUp)).toBe(true);
  });

  it('makes visemes from mixes of ARKit shapes when the model has no viseme shapes', () => {
    const model = makeModel();
    const visemeShapes = Object.fromEntries(VISEMES.map((v) => [v, {}])) as Record<
      VisemeId,
      Partial<Record<ArkitBlendshape, number>>
    >;
    visemeShapes.aa = { jawOpen: 0.7, mouthFunnel: 0.2 };
    const manifest: AvatarAssetManifest = { ...MANIFEST, morphTargets: { arkit, visemeShapes } };
    const rig = createAvatarRig({ root: model.root, clips: model.clips, manifest });

    rig.apply({ ...REST, blendshapes: { jawOpen: 0.1 }, visemes: { aa: 0.5 } });

    expect(influence(model.face, 'jawOpen')).toBeCloseTo(0.1 + 0.35);
    expect(influence(model.face, 'mouthFunnel')).toBeCloseTo(0.1);
    expect(influence(model.face, 'viseme_aa')).toBe(0.5); // untouched default: this manifest maps no viseme morphs
  });
});
