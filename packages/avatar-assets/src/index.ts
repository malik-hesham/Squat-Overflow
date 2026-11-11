// The digital human's 3D files: the manifest of each model, and the checks that keep them valid.
// The files themselves: import '@squat-overflow/avatar-assets/models/<id>/<profile>.glb'.
export { materialSettings, type MaterialSettings } from './build/materials.ts';
export { checkModel, checkProfilesMatch } from './checks.ts';
export { readGlbJson, type Utf8Decoder } from './glb.ts';
export { COACH_01 } from './models/coach-01.ts';
export { summarizeGltf, type ModelSummary } from './summary.ts';
