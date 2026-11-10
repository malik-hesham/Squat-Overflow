"""Installs MakeHuman asset packs into MPFB's user data folder, with MPFB's own extractor.

Run: blender --background --python install_packs.py -- <pack.zip> [<pack.zip> ...]
The zips and their checksums are listed in packages/avatar-assets/SOURCES.md.
"""
import sys

from bl_ext.user_default.mpfb.services.assetservice import AssetService
from bl_ext.user_default.mpfb.services.locationservice import LocationService

zips = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if not zips:
    raise SystemExit("usage: blender --background --python install_packs.py -- <pack.zip> ...")

target = LocationService.get_user_data()
for path in zips:
    problem = AssetService.check_asset_pack_zip(path)
    if problem not in (None, "STRUCTURE", "MACOS"):  # the last two MPFB fixes while extracting
        raise SystemExit(f"{path}: not an asset pack ({problem})")
    error = AssetService.fix_and_extract_asset_pack_zip(path, target)
    if error:
        raise SystemExit(f"{path}: could not install ({error})")
    print(f"installed {path}")

AssetService.rescan_pack_metadata()
print("MPFB user data:", target)
print("packs:", sorted(AssetService.get_pack_names()))
