// Copies the MediaPipe pose runtime into lib/vendor/mediapipe/, so the extension runs the pose model
// with no network (MV3 forbids remote code anyway). Run after changing the @mediapipe/tasks-vision
// version in package.json:   cd extension && npm run vendor
//
// The model is the phone's own file (mobile/modules/squat-pose/assets), so both clients see the same
// landmarks; tests/check.mjs checks the two copies match.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const from = (p) => new URL(`../node_modules/@mediapipe/tasks-vision/${p}`, import.meta.url);
const out = new URL("../lib/vendor/mediapipe/", import.meta.url);
mkdirSync(out, { recursive: true });

const pkg = JSON.parse(readFileSync(from("package.json"), "utf8"));
// No source map in the extension: drop the comment, or DevTools asks for a file that isn't there.
writeFileSync(new URL("vision_bundle.mjs", out), readFileSync(from("vision_bundle.mjs"), "utf8").replace(/\n?\/\/# sourceMappingURL=.*\s*$/, "\n"));
// Named after the bundle, so TypeScript uses it instead of checking the minified code.
copyFileSync(from("vision.d.ts"), new URL("vision_bundle.d.mts", out));
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm"]) copyFileSync(from(`wasm/${f}`), new URL(f, out));
copyFileSync(new URL("../../mobile/modules/squat-pose/assets/pose_landmarker_lite.task", import.meta.url), new URL("pose_landmarker_lite.task", out));
writeFileSync(
  new URL("LICENSE", out),
  `${pkg.name} ${pkg.version} (vision_bundle.mjs, vision_bundle.d.mts, vision_wasm_internal.*) and the\n` +
    `pose_landmarker_lite.task model are by Google, under the ${pkg.license} license:\n` +
    `https://www.apache.org/licenses/LICENSE-2.0\n` +
    `Source: https://github.com/google-ai-edge/mediapipe\n`,
);
console.log(`Vendored ${pkg.name} ${pkg.version} into lib/vendor/mediapipe/`);
