import { NitroModules } from 'react-native-nitro-modules';

import type { PoseDetector, PoseResult } from './specs/PoseDetector.nitro';

export type { PoseDetector, PoseResult };

export function createPoseDetector(): PoseDetector {
  return NitroModules.createHybridObject<PoseDetector>('PoseDetector');
}
