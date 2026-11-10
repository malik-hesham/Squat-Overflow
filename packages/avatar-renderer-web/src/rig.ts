// WebAnimationAdapter: applies avatar-core's AvatarFrame to a loaded three.js model. Core decides the
// pose; this only maps canonical names (ARKit shapes, visemes, bones, clip slots) to the model's own,
// through its manifest.
import type {
  AnimationSlot,
  ArkitBlendshape,
  AvatarAssetManifest,
  AvatarFrame,
  EyeRotation,
  HeadRotation,
  VisemeId,
} from '@squat-overflow/avatar-types';
import { EYE_RANGE } from '@squat-overflow/avatar-core';
import * as THREE from 'three';

/**
 * Without eye bones, gaze uses the ARKit eyeLook shapes: a shape at full weight stands for the
 * furthest eye turn avatar-core makes (EYE_RANGE, about the comfortable range of a human eye).
 */
export const EYE_YAW_MAX = EYE_RANGE.yaw;
export const EYE_PITCH_MAX = EYE_RANGE.pitch;

/** How far a full breath lifts the chest (frame.breath = 1). */
export const BREATH_PITCH_MAX = THREE.MathUtils.degToRad(1.5);

export interface AvatarRigOptions {
  /** The model's scene (gltf.scene). */
  readonly root: THREE.Object3D;
  /** The model's clips (gltf.animations). */
  readonly clips: readonly THREE.AnimationClip[];
  readonly manifest: AvatarAssetManifest;
}

export interface AvatarRig {
  /** Poses the model for one frame. */
  apply(frame: AvatarFrame): void;
}

interface MorphBinding {
  readonly influences: number[];
  readonly index: number;
  readonly value: (frame: AvatarFrame) => number;
}

export function createAvatarRig({ root, clips, manifest }: AvatarRigOptions): AvatarRig {
  const { morphTargets } = manifest;
  const bone = (name: string | undefined) => (name ? root.getObjectByName(name) : undefined);
  const leftEye = bone(manifest.skeleton.leftEye);
  const rightEye = bone(manifest.skeleton.rightEye);
  const eyeBones = leftEye && rightEye ? { left: leftEye, right: rightEye } : null;
  /** This frame's gaze as eyeLook shapes, when there are no eye bones. */
  const gaze: Partial<Record<ArkitBlendshape, number>> = {};
  /** For a model without viseme shapes: which visemes feed each ARKit shape, and how much. */
  const visemeMix = new Map<ArkitBlendshape, (readonly [VisemeId, number])[]>();
  if ('visemeShapes' in morphTargets) {
    for (const [viseme, shapes] of Object.entries(morphTargets.visemeShapes)) {
      for (const [shape, amount] of Object.entries(shapes)) {
        const list = visemeMix.get(shape as ArkitBlendshape) ?? [];
        list.push([viseme as VisemeId, amount]);
        visemeMix.set(shape as ArkitBlendshape, list);
      }
    }
  }
  const shapeWeight = (f: AvatarFrame, shape: ArkitBlendshape) => {
    let weight = (f.blendshapes[shape] ?? 0) + (gaze[shape] ?? 0);
    for (const [viseme, amount] of visemeMix.get(shape) ?? [])
      weight += (f.visemes[viseme] ?? 0) * amount;
    return Math.min(1, weight);
  };
  const sources: (readonly [target: string, value: (frame: AvatarFrame) => number])[] = [
    ...Object.entries(morphTargets.arkit).map(
      ([shape, target]) =>
        [target, (f: AvatarFrame) => shapeWeight(f, shape as ArkitBlendshape)] as const
    ),
    ...('visemes' in morphTargets ? Object.entries(morphTargets.visemes) : []).map(
      ([viseme, target]) =>
        [target, (f: AvatarFrame) => f.visemes[viseme as VisemeId] ?? 0] as const
    ),
  ];

  const bindings: MorphBinding[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const dictionary = mesh.morphTargetDictionary;
    const influences = mesh.morphTargetInfluences;
    if (!dictionary || !influences) return;
    for (const [target, value] of sources) {
      const index = dictionary[target];
      if (index !== undefined) bindings.push({ influences, index, value });
    }
  });

  // One action per clip slot the model has. Core keeps clip time, so the mixer never advances on
  // its own: each frame sets every action's weight and time, then evaluates once.
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map<AnimationSlot, THREE.AnimationAction>();
  for (const [slot, ref] of Object.entries(manifest.animations)) {
    const clip = clips.find((c) => c.name === ref.clip);
    if (!clip) continue;
    const action = mixer.clipAction(clip);
    action.play();
    action.setEffectiveWeight(0);
    actions.set(slot as AnimationSlot, action);
  }

  // Bones the frame turns on top of the clips. Each frame starts them from their rest rotation, so
  // turns never pile up; the mixer then writes the ones a clip animates.
  const chest = bone(manifest.skeleton.chest);
  const neck = bone(manifest.skeleton.neck);
  const head = bone(manifest.skeleton.head);
  const turned = [chest, neck, head, leftEye, rightEye].filter(
    (b): b is THREE.Object3D => b !== undefined
  );
  const rest = new Map(turned.map((b) => [b, b.quaternion.clone()]));

  return {
    apply(frame) {
      for (const [b, q] of rest) b.quaternion.copy(q);
      for (const action of actions.values()) action.setEffectiveWeight(0);
      for (const { slot, weight, timeMs } of frame.clips) {
        const action = actions.get(slot);
        if (!action) continue; // a clip the model doesn't have
        action.setEffectiveWeight(weight);
        action.time = timeMs / 1000;
      }
      mixer.update(0);
      if (chest) turn(root, chest, { yaw: 0, pitch: frame.breath * BREATH_PITCH_MAX, roll: 0 });
      if (neck) turn(root, neck, frame.neck);
      if (head) turn(root, head, frame.head);
      if (eyeBones) {
        turn(root, eyeBones.left, { ...frame.eyes.left, roll: 0 });
        turn(root, eyeBones.right, { ...frame.eyes.right, roll: 0 });
      } else {
        gazeShapes(frame.eyes.left, frame.eyes.right, gaze);
      }

      for (const { influences, index, value } of bindings) influences[index] = value(frame);
    },
  };
}

// Reused every frame: a render loop shouldn't allocate.
const scratch = {
  euler: new THREE.Euler(),
  turn: new THREE.Quaternion(),
  root: new THREE.Quaternion(),
  rootInverse: new THREE.Quaternion(),
  parent: new THREE.Quaternion(),
  parentInverse: new THREE.Quaternion(),
};

/**
 * Turns `bone` by `rotation`, given in avatar space (+Y up, +Z out of the face, +X the avatar's left):
 * positive yaw to its left, positive pitch up, positive roll towards its left shoulder. Works whatever
 * the bone's own axes are, by expressing the turn in its parent's frame.
 */
function turn(root: THREE.Object3D, bone: THREE.Object3D, rotation: HeadRotation): void {
  const { euler, turn: q, root: r, rootInverse: ri, parent: p, parentInverse: pi } = scratch;
  // Yaw about +Y; pitch up is a negative turn about +X; roll left a negative turn about +Z.
  q.setFromEuler(euler.set(-rotation.pitch, rotation.yaw, -rotation.roll, 'YXZ'));
  root.updateWorldMatrix(true, false);
  root.getWorldQuaternion(r);
  q.premultiply(r).multiply(ri.copy(r).invert()); // avatar space → world
  if (bone.parent) {
    bone.parent.updateWorldMatrix(true, false);
    bone.parent.getWorldQuaternion(p);
  } else {
    p.identity();
  }
  // new world = turn × old world, so new local = parent⁻¹ × turn × parent × old local
  bone.quaternion.premultiply(pi.copy(p).invert().multiply(q).multiply(p));
  bone.updateMatrixWorld(true);
}

/**
 * Eye turns as eyeLook shapes. Looking to the avatar's left is "out" for its left eye and "in" for its
 * right eye; each shape is capped at full weight.
 */
function gazeShapes(
  left: EyeRotation,
  right: EyeRotation,
  out: Partial<Record<ArkitBlendshape, number>>
) {
  const part = (amount: number, max: number) => Math.min(1, Math.max(0, amount / max));
  out.eyeLookOutLeft = part(left.yaw, EYE_YAW_MAX);
  out.eyeLookInLeft = part(-left.yaw, EYE_YAW_MAX);
  out.eyeLookUpLeft = part(left.pitch, EYE_PITCH_MAX);
  out.eyeLookDownLeft = part(-left.pitch, EYE_PITCH_MAX);
  out.eyeLookInRight = part(right.yaw, EYE_YAW_MAX);
  out.eyeLookOutRight = part(-right.yaw, EYE_YAW_MAX);
  out.eyeLookUpRight = part(right.pitch, EYE_PITCH_MAX);
  out.eyeLookDownRight = part(-right.pitch, EYE_PITCH_MAX);
}
