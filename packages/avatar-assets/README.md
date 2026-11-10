# @squat-overflow/avatar-assets

The digital human's 3D files and the checks that keep them valid.

- `models/coach-01/high.glb` (desktop) and `optimized.glb` (extension, mobile): the same person, rig and
  face shapes (52 ARKit + 15 visemes), plus an `idle` clip (the arms' rest pose; breathing is
  avatar-core's). Sizes, triangle counts, checksums and the eye centres are in the generated manifest,
  `src/models/coach-01.ts` (`COACH_01`).
- `sources/human.json`: who the human is (body, skin, hair, clothes, rig). Change the look there and
  rebuild.
- `SOURCES.md`: every source file with its licence (all CC0) and checksum, and the rebuild steps.
- `src/`: reading GLB files (`readGlbJson`, `summarizeGltf`), checking a model against its manifest
  (`checkModel`, `checkProfilesMatch`), the material rule the build applies (`materialSettings`) and
  where the eyes are (`eyeCentres`, from the eye mesh through its skin).

`pnpm test` checks the shipped files: the size and SHA-256 the manifest records, no glTF validator
errors, every mapped face shape, bone and clip present, matching profiles, the right material modes, the
eyes where the manifest says, and an idle clip that leaves the chest still.

This is built from open assets with MakeHuman's tools. It has realistic proportions; it is **not
photorealistic**. See [docs/digital-human/assets.md](../../docs/digital-human/assets.md).
