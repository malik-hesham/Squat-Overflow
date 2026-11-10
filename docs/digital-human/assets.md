# Digital human: 3D asset requirements and import pipeline

Status: planned for Phase 3. No model is in the repo yet. The types the pipeline fills
(`AvatarAssetManifest`, `HUMANOID_BONES`, `ANIMATION_SLOTS`, `ARKIT_BLENDSHAPES`, `VISEMES`) are in
[`packages/avatar-types/src`](../../packages/avatar-types/src).

## What the engine needs from a model

One identity, shipped as two files from the same source:

| Profile   | Used by           | Triangles (target) | Textures                           | Geometry                    |
| --------- | ----------------- | ------------------ | ---------------------------------- | --------------------------- |
| HIGH      | desktop           | 50k to 80k         | skin 4K, others 2K, KTX2           | meshopt                     |
| OPTIMIZED | extension, mobile | 15k to 25k         | 1K to 2K, KTX2 (mobile: see below) | meshopt (mobile: see below) |

Both profiles must have the **same skeleton (bone names and bind pose) and the same morph target names**,
so one set of animation clips and one `AvatarFrame` drive either file. The validator checks this.

File rules:

- glTF 2.0 binary (`.glb`), Y up, metres, facing +Z, feet at the origin, bind pose in T or A pose.
- One skeleton; at most 4 bone influences per vertex.
- Morph targets named in `mesh.extras.targetNames` (three.js reads this):
  - the 52 ARKit blendshapes (`eyeBlinkLeft` … `tongueOut`) on the face mesh, and on the meshes that must
    move with it (eyelashes with the blinks, lower teeth and tongue with `jawOpen`);
  - the 15 Oculus visemes (`sil`, `PP`, `FF`, `TH`, `DD`, `kk`, `CH`, `SS`, `nn`, `RR`, `aa`, `E`, `I`,
    `O`, `U`), or a viseme-to-ARKit table in the manifest when the model only has ARKit shapes.
- Bones for `HUMANOID_BONES` (hips, spine, chest, neck, head, left and right eye). If there are no eye
  bones, the `eyeLook*` blendshapes are used instead.
- PBR metallic-roughness materials. Skin: base colour, normal and roughness maps. Eyes: separate cornea
  and iris meshes. Eyelashes and hair: alpha-tested cards.

Names don't have to match the canonical ones. The manifest maps each canonical name to the model's own
name (`morphTargets.arkit`, `morphTargets.visemes`, `skeleton.bones`), so an export with other names
(Avaturn, a Ready Player Me style export, our own) drops in without code changes.

Mobile caveat (spike S1 decides): Hermes can't run the WebAssembly decoders for KTX2 and meshopt, so the
mobile OPTIMIZED file may need plain geometry and pre-transcoded or PNG/JPEG textures.

## Where the model comes from

You asked me to build the human. The plan for Phase 3, to confirm before I start:

1. **Base: MakeHuman's open assets** (body mesh, skins, eyes, eyebrows, eyelashes, teeth, tongue, hair,
   clothes; the assets are CC0) built in **Blender** with a script, run headless. Blender is not installed
   on this Mac; Phase 3 starts by asking you to install it.
2. **Rig:** a humanoid skeleton with the bones above.
3. **Face shapes:** the 52 ARKit shapes and 15 visemes, made by posing the face rig per shape and baking
   each pose into a shape key. Every shape gets a render in a contact sheet for review.
4. **OPTIMIZED:** a lower-polygon version of the same body (not a decimated copy: decimating destroys
   shape keys), with the shape keys transferred onto it.
5. **Licence record:** every source file with its licence and URL goes into the manifest's `license`
   field and `packages/avatar-assets/SOURCES.md`.

What that gives: a realistic-proportioned, fully rigged human that can blink, look, talk and emote. What it
doesn't give: **photorealism**. A photoreal likeness needs scanned skin and a likeness source, for example
an Avaturn T2 export from your photo, which fits the same slot (see "Importing a model" below). I will not
describe the built model as photorealistic.

Rejected: building the body procedurally in code (like the exercise demo's `extension/lib/demo-body.js`).
It can't reach a realistic face.

## Import pipeline

```
source .blend / vendor .glb
  │  blender --background --python packages/avatar-assets/scripts/export.py   (our own model only)
  ▼
raw .glb (HIGH topology + OPTIMIZED topology)
  │  node packages/avatar-assets/scripts/build-profiles.mjs
  │    ├─ validate: glTF validator, then our checks (bones, morph names, both profiles match)
  │    ├─ clean: dedup, prune, weld; quantize; morph targets kept (sparse)
  │    ├─ textures → KTX2 (UASTC for normal maps, ETC1S for colour), sizes per profile
  │    └─ geometry → meshopt (EXT_meshopt_compression)
  ▼
packages/avatar-assets/models/<id>/{high,optimized}.glb + manifest.json (sizes, sha256, licence)
```

Tools (installed in Phase 3): Blender, `@gltf-transform/cli` and its functions, KTX-Software (`ktx`) for
texture compression, the Khronos glTF validator.

The validator also runs in `pnpm check`, so a broken or mismatched model fails CI.

## Importing a model (for example an Avaturn export)

Once Phase 3 is built:

1. Export the avatar as `.glb` with ARKit blendshapes (and visemes, if offered). In Avaturn, that is the
   T2 body type. Check the exact export options on avaturn.me; I couldn't confirm its morph target names.
2. Put the file in `packages/avatar-assets/sources/<id>/source.glb` and its licence terms in
   `SOURCES.md`.
3. Run `pnpm --filter @squat-overflow/avatar-assets run inspect sources/<id>/source.glb`. It lists the bones
   and morph targets and prints a draft `manifest.json` mapping them to the canonical names.
4. Fix any name the draft couldn't map, then run `build-profiles`. The validator says exactly what is
   missing.
