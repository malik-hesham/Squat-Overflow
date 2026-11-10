"""Builds the digital human from MakeHuman's CC0 assets with MPFB, and exports one GLB per profile.

Run (from packages/avatar-assets):
  blender --background --python scripts/blender/build_human.py -- \
      --config sources/human.json --profile high --out build/high.glb

MPFB and the asset packs must be installed first (install_packs.py, SOURCES.md). The GLB still needs
post-processing (scripts/build-profiles.mjs) before it goes into models/.
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector
from bl_ext.user_default.mpfb.services.assetservice import AssetService
from bl_ext.user_default.mpfb.services.exportservice import ExportService
from bl_ext.user_default.mpfb.services.faceservice import FaceService
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService

PROFILES = ("high", "optimized")

# Mesh names in the model. The engine (manifest, materials) refers to parts by these names.
PART_NAMES = {"eyes": "Eyes", "eyebrows": "Eyebrows", "eyelashes": "Eyelashes", "teeth": "Teeth",
              "tongue": "Tongue", "hair": "Hair"}

FPS = 30
IDLE_SECONDS = 4
# Arm directions for the idle pose, in the rig's space (+Z up, +X the character's left, -Y its front):
# upper arms hang down a little away from the hips, forearms bend slightly forward.
UPPER_ARM_DOWN = Vector((0.12, 0.0, -1.0))
FOREARM_DOWN = Vector((0.06, -0.22, -1.0))
BREATH_DEGREES = 1.2


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="build_human.py")
    parser.add_argument("--config", required=True)
    parser.add_argument("--profile", required=True, choices=PROFILES)
    parser.add_argument("--out", required=True)
    return parser.parse_args(argv)


def find(fragment, subdir):
    path = AssetService.find_asset_absolute_path(fragment, asset_subdir=subdir)
    if path is None:
        raise SystemExit(f"asset not found: {subdir}/{fragment} (is the system assets pack installed?)")
    return path


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def build(config, profile):
    clear_scene()
    basemesh = HumanService.create_human(macro_detail_dict=config["phenotype"], scale=0.1, feet_on_ground=True)
    # The body shape (gender, age, ...) is a stack of shape keys: fold it into the mesh, so the only
    # shape keys left on the model are the face ones loaded below.
    TargetService.bake_targets(basemesh)

    # Rig first: everything added after it is rigged and weighted to it.
    if HumanService.add_builtin_rig(basemesh, config["rig"]) is None:
        raise SystemExit(f"rig not found: {config['rig']}")

    HumanService.set_character_skin(find(config["skin"], "skins"), basemesh, skin_type="GAMEENGINE",
                                    material_instances=False)
    parts = dict(config["bodyparts"], eyes=config["eyes"][profile])
    for part, fragment in parts.items():
        HumanService.add_mhclo_asset(find(fragment, part), basemesh, asset_type=part, subdiv_levels=0,
                                     material_type="MAKESKIN")
    for fragment in config["clothes"]:
        HumanService.add_mhclo_asset(find(fragment, "clothes"), basemesh, asset_type="clothes", subdiv_levels=0,
                                     material_type="MAKESKIN")

    # The 15 Meta visemes and 52 ARKit face units, as shape keys at zero weight, then carried over to
    # every fitted mesh (eyes, brows, lashes, teeth, tongue, hair, clothes) through MPFB's MHCLO data.
    FaceService.load_targets(basemesh, load_microsoft_visemes=False, load_meta_visemes=True,
                             load_arkit_faceunits=True)
    FaceService.interpolate_targets(basemesh)

    # HIGH: one level of subdivision on the body (4x the faces), baked below with the face shape keys
    # kept. OPTIMIZED keeps MakeHuman's base topology. Both share the rig and the face shapes.
    if profile == "high":
        subsurf = basemesh.modifiers.new("HighSubdivision", "SUBSURF")
        subsurf.levels = subsurf.render_levels = 1

    # Apply the masks under the clothes and drop MPFB's helper geometry, keeping the face shape keys.
    ExportService.bake_modifiers_remove_helpers(basemesh, bake_masks=True, bake_subdiv=(profile == "high"),
                                                remove_helpers=True, also_proxy=False)
    for obj in bpy.data.objects:
        for modifier in list(obj.modifiers):
            if modifier.type == "SUBSURF":  # the glTF exporter can't apply modifiers on meshes with shape keys
                obj.modifiers.remove(modifier)

    name_parts(basemesh, parts)
    add_idle_clip(next(o for o in bpy.data.objects if o.type == "ARMATURE"))
    return basemesh


def name_parts(basemesh, parts):
    """Body, Eyes, Eyebrows, ... for meshes and materials; clothes keep their asset name."""
    part_of_asset = {os.path.splitext(os.path.basename(f))[0]: part for part, f in parts.items()}
    for obj in list(bpy.data.objects):
        if obj.type == "ARMATURE":
            obj.name = obj.data.name = "Rig"
            continue
        if obj.type != "MESH":
            continue
        asset = obj.name.split(".", 1)[1] if "." in obj.name else obj.name
        name = "Body" if obj is basemesh else PART_NAMES.get(part_of_asset.get(asset), asset)
        obj.name = obj.data.name = name
        for slot in obj.material_slots:
            if slot.material:
                slot.material.name = name


def aim(rig, bone_name, direction):
    """Turns a bone (about its head) so it points along `direction`, in the rig's space."""
    bpy.context.view_layer.update()
    bone = rig.pose.bones[bone_name]
    current = bone.matrix.to_3x3() @ Vector((0.0, 1.0, 0.0))  # a bone points along its own Y axis
    turn = current.normalized().rotation_difference(direction.normalized()).to_matrix().to_4x4()
    head = bone.matrix.translation.copy()
    matrix = turn @ bone.matrix
    matrix.translation = head
    bone.matrix = matrix
    bpy.context.view_layer.update()


def add_idle_clip(rig):
    """The `idle` clip: arms hanging down from MakeHuman's A-pose, and slow breathing in the chest."""
    scene = bpy.context.scene
    scene.render.fps = FPS
    last = 1 + FPS * IDLE_SECONDS
    for side, x in (("l", 1.0), ("r", -1.0)):
        aim(rig, f"upperarm_{side}", Vector((UPPER_ARM_DOWN.x * x, UPPER_ARM_DOWN.y, UPPER_ARM_DOWN.z)))
        aim(rig, f"lowerarm_{side}", Vector((FOREARM_DOWN.x * x, FOREARM_DOWN.y, FOREARM_DOWN.z)))
    arms = [f"{b}_{s}" for b in ("upperarm", "lowerarm") for s in ("l", "r")]
    chest = rig.pose.bones["spine_03"]
    rest_chest = chest.rotation_euler.copy()
    for frame, breath in ((1, 0.0), (1 + last // 2, 1.0), (last, 0.0)):
        for name in arms:
            rig.pose.bones[name].keyframe_insert("rotation_euler", frame=frame)
        chest.rotation_euler = rest_chest.copy()
        chest.rotation_euler.x += math.radians(-BREATH_DEGREES * breath)  # chest lifts as it fills
        chest.keyframe_insert("rotation_euler", frame=frame)
    rig.animation_data.action.name = "idle"
    scene.frame_start, scene.frame_end = 1, last


def select_human_only():
    """Exports only the rig and what hangs off it (MPFB can leave helper objects in the scene)."""
    rig = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    keep = {rig, *rig.children_recursive}
    for obj in bpy.data.objects:
        obj.select_set(obj in keep)


def export(path):
    select_human_only()
    bpy.ops.export_scene.gltf(
        filepath=path,
        use_selection=True,
        export_format="GLB",
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_def_bones=True,
        export_morph=True,
        export_morph_normal=True,
        export_try_sparse_sk=True,
        export_animations=True,
        export_anim_slide_to_zero=True,  # clips start at time 0, so a loop has no flat spot
        export_materials="EXPORT",
        export_image_format="AUTO",
    )


def report():
    for obj in sorted(bpy.data.objects, key=lambda o: o.name):
        keys = obj.data.shape_keys.key_blocks if obj.type == "MESH" and obj.data.shape_keys else []
        polys = len(obj.data.polygons) if obj.type == "MESH" else 0
        print(f"object {obj.name} type={obj.type} faces={polys} shape_keys={max(len(keys) - 1, 0)}")


def main():
    args = parse_args()
    with open(args.config, encoding="utf-8") as f:
        config = json.load(f)
    build(config, args.profile)
    report()
    export(args.out)
    print(f"exported {args.out}")


main()
