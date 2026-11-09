/**
 * On-device pose analysis (rep counting, form scores, calibration), shared with the extension:
 * the code lives in `extension/lib/pose` and the app imports it as-is, like `src/core/shared.ts`
 * does for the other extension modules. See that folder's index.js for how to call it.
 */
export * from '../../../../extension/lib/pose/index.js';
