"""
One-off post-process on the already-generated WDPA output:
  1. Merge the two Unclassified-Terrestrial chunk files back into one — safe
     now that they're simplified and much smaller than when they had to be
     split to fit in memory.
  2. Rename each polygon layer file + its internal TopoJSON object from raw
     IUCN_CAT codes to a semantic slug.

Operates directly on pipeline/raw_data/wdpa/output/ — does not re-run the
pipeline or touch the raw source data.

Run with:
    pipeline/.venv/bin/python3 -m pipeline.rename_wdpa_layers_once
"""

import subprocess
from pathlib import Path

POLY_DIR = Path(__file__).parent / "raw_data/wdpa/output/wdpa/polygons"

SLUGS = {
    "Ia": "strict_nature_reserve",
    "Ib": "wilderness_area",
    "II": "national_park",
    "III": "natural_monument",
    "IV": "habitat_species_management_area",
    "V": "protected_landscape_seascape",
    "VI": "managed_resource_protected_area",
    "Unclassified_Coastal": "unclassified_coastal",
    "Unclassified_Marine": "unclassified_marine",
    "Unclassified_Terrestrial": "unclassified_terrestrial",
}


def _merge_terrestrial():
    a = POLY_DIR / "Unclassified_Terrestrial_0.topojson"
    b = POLY_DIR / "Unclassified_Terrestrial_1.topojson"
    out = POLY_DIR / "Unclassified_Terrestrial.topojson"
    if not a.exists() or not b.exists():
        print(f"  {a.name}/{b.name} not both found, skipping merge")
        return
    print(f"Merging {a.name} + {b.name} -> {out.name}...")
    result = subprocess.run(
        [
            "mapshaper",
            "-i", str(a), "name=t0",
            "-i", str(b), "name=t1",
            "-merge-layers", "target=t0,t1", "force", "name=Unclassified_Terrestrial",
            "-o", "format=topojson", "quantization=1000000", "bbox", str(out),
        ],
        capture_output=True, text=True, timeout=600,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())
    if not out.exists() or out.stat().st_size == 0:
        raise RuntimeError(f"mapshaper reported success but {out} was not created")
    a.unlink()
    b.unlink()
    print(f"  Done: {out.stat().st_size / 1024 / 1024:.1f}MB")


def _rename(old_name: str, slug: str):
    src = POLY_DIR / f"{old_name}.topojson"
    if not src.exists():
        print(f"  ✗ {src.name} not found, skipping")
        return
    dest = POLY_DIR / f"{slug}.topojson"
    # macOS/APFS is case-insensitive by default, so a rename that differs only
    # by case (e.g. Unclassified_Coastal -> unclassified_coastal) resolves to
    # the SAME file on disk. Writing through a distinctly-named temp file
    # avoids mapshaper silently overwriting src in place, and we verify the
    # new file actually exists before deleting src.
    tmp_dest = POLY_DIR / f"__tmp_{slug}.topojson"
    print(f"Renaming {src.name} -> {dest.name} (object: {old_name} -> {slug})...")
    result = subprocess.run(
        [
            "mapshaper", str(src),
            "-rename-layers", slug,
            "-o", "format=topojson", "quantization=1000000", "bbox", str(tmp_dest),
        ],
        capture_output=True, text=True, timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())
    if not tmp_dest.exists() or tmp_dest.stat().st_size == 0:
        raise RuntimeError(f"mapshaper reported success but {tmp_dest} was not created")
    src.unlink()
    tmp_dest.rename(dest)


if __name__ == "__main__":
    _merge_terrestrial()
    for old_name, slug in SLUGS.items():
        _rename(old_name, slug)
    print("\nDone. Final files:")
    for p in sorted(POLY_DIR.glob("*.topojson")):
        print(f"  {p.name}: {p.stat().st_size / 1024 / 1024:.1f}MB")
