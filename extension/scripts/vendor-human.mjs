// Copies the digital human built in Blender (packages/avatar-assets, model coach-01) into models/, so
// the exercise demo has a person to show with no network. The extension ships the "optimized"
// profile, as docs/digital-human/architecture.md plans. Run after rebuilding the model:
//   cd extension && npm run vendor:human
// tests/check.mjs checks the copy against the SHA-256 in avatar-assets' manifest.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const assets = new URL("../../packages/avatar-assets/", import.meta.url);
const out = new URL("../models/", import.meta.url);
mkdirSync(out, { recursive: true });
copyFileSync(new URL("models/coach-01/optimized.glb", assets), new URL("coach-01.glb", out));
// Every source of the model is CC0; the list (with checksums) stays in avatar-assets' SOURCES.md.
const sources = readFileSync(new URL("SOURCES.md", assets), "utf8");
writeFileSync(
  new URL("coach-01.LICENSE", out),
  "coach-01.glb is the optimized profile of packages/avatar-assets' coach-01, built with Blender and\n" +
    "MakeHuman's MPFB from MakeHuman assets, all under CC0 1.0 (no rights reserved):\n" +
    "https://creativecommons.org/publicdomain/zero/1.0/\n\n" +
    sources,
);
console.log("vendor-human: copied coach-01 (optimized) to models/coach-01.glb");
