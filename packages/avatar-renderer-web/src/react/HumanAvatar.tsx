// HumanAvatar: the model in an AvatarScene, posed every frame from an AvatarFrameSource (avatar-core).
import type { AvatarFrameSource } from '@squat-overflow/avatar-types';
import { useFrame, useThree } from '@react-three/fiber';
import { useContext, useLayoutEffect, useMemo } from 'react';
import type * as THREE from 'three';
import { frameCamera } from '../camera.ts';
import type { LoadedAvatarModel } from '../loader.ts';
import { createAvatarRig } from '../rig.ts';
import { FramingContext } from './AvatarScene.tsx';

export interface HumanAvatarProps {
  /** From useAvatarModel (or loadAvatarModel); whoever loaded it disposes it. */
  readonly model: LoadedAvatarModel;
  readonly frames: AvatarFrameSource;
}

export function HumanAvatar({ model, frames }: HumanAvatarProps) {
  const framing = useContext(FramingContext);
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const rig = useMemo(
    () => createAvatarRig({ root: model.root, clips: model.clips, manifest: model.manifest }),
    [model]
  );
  useLayoutEffect(() => {
    rig.apply(frames.frame()); // pose once so the camera frames the avatar as it stands
    frameCamera(camera, model, framing);
  }, [rig, frames, camera, model, framing]);
  useFrame(() => {
    rig.apply(frames.frame());
  });
  return <primitive object={model.root} />;
}
