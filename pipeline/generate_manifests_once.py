"""
One-off: (re)generate the WDPA + GeoNames catalog manifests from their already
-produced output files, WITHOUT re-running the expensive fetch pipelines.

Both sources' outputs already sit under pipeline/raw_data/<source>/output/. This
reads those files directly (the true source of truth for what gets uploaded to
R2) and writes pipeline/manifests/{wdpa,geonames}.json via catalog.write_manifest.
A future full re-run of either source overwrites its manifest at the end, so this
is safe to run now as a backfill.

Run with:
    pipeline/.venv/bin/python3 -m pipeline.generate_manifests_once

Note: WDPA's polygon layers are renamed to slugs by rename_wdpa_layers_once.py
*after* the fetch, so the manifest is reconstructed from the final renamed files
here — not from WDPA.fetch(), which would report the pre-rename IUCN codes.
"""

import json
from pathlib import Path

import pandas as pd

from . import catalog
from .rename_wdpa_layers_once import SLUGS
from .sources.base import DatasetMeta
from .sources.geonames import CATEGORY_DISPLAY_NAMES, GROUPS
from .sources.wdpa import IUCN_CAT_NAMES

WDPA_OUT = Path(__file__).parent / "raw_data/wdpa/output"
GEONAMES_OUT = Path(__file__).parent / "raw_data/geonames/output"


def wdpa_datasets(output_dir: Path) -> list[DatasetMeta]:
    # Points (protected areas reported without boundary geometry) are dropped
    # from the catalog by decision — polygons only.
    datasets = []

    # slug (on-disk object name) -> human display name. Standard categories map
    # back through IUCN_CAT_NAMES (semantic name, no IUCN code); the
    # Unclassified_<realm> splits become "Unclassified <realm>".
    slug_display = {}
    for iucn, slug in SLUGS.items():
        if iucn in IUCN_CAT_NAMES:
            slug_display[slug] = IUCN_CAT_NAMES[iucn]
        else:
            slug_display[slug] = f"Unclassified {iucn.split('_', 1)[1]}"

    # One standalone dataset per IUCN category (each is its own single-file
    # polygon layer), rather than a single "Protected Areas" dataset with many
    # layers.
    poly_dir = output_dir / "wdpa/polygons"
    for p in sorted(poly_dir.glob("*.topojson")):
        topo = json.load(open(p))
        object_name = next(iter(topo["objects"]))  # one object per file
        name = slug_display.get(object_name, object_name)
        datasets.append(DatasetMeta(
            id=f"wdpa/{object_name}",
            name=name,
            description=f"{name} — protected area boundaries from the WDPA.",
            source="wdpa",
            source_name="WDPA",
            admin_level=0,
            region="world",
            license="non-commercial",
            tags=["protected-areas", "conservation", "world", "polygons"],
            file_path=str(p.relative_to(output_dir)),
            feature_count=len(topo["objects"][object_name]["geometries"]),
            bbox=topo.get("bbox", [-180, -90, 180, 90]),
            geometry_type="Polygon",
        ))
    return datasets


def geonames_datasets(output_dir: Path) -> list[DatasetMeta]:
    datasets = []
    # One standalone dataset per category CSV (not grouped multi-layer datasets),
    # so each loads independently. Mirrors GeoNames.fetch().
    for group, meta in GROUPS.items():
        group_dir = output_dir / "geonames" / group
        if not group_dir.exists():
            continue
        for csv in sorted(group_dir.glob("*.csv")):
            category = csv.stem
            df = pd.read_csv(csv, usecols=["latitude", "longitude"])
            lon = pd.to_numeric(df["longitude"], errors="coerce")
            lat = pd.to_numeric(df["latitude"], errors="coerce")
            bbox = [float(lon.min()), float(lat.min()), float(lon.max()), float(lat.max())]
            display_name = CATEGORY_DISPLAY_NAMES[group].get(category, category)
            datasets.append(DatasetMeta(
                id=f"geonames/{group}-{category}".replace("_", "-"),
                name=display_name,
                description=f"{display_name} worldwide — GeoNames point data.",
                source="geonames",
                source_name="GeoNames",
                admin_level=0,
                region="world",
                license="CC-BY 4.0",
                tags=meta["tags"],
                file_path=str(csv.relative_to(output_dir)),
                feature_count=len(df),
                bbox=bbox,
                geometry_type="Point",
            ))
    return datasets


if __name__ == "__main__":
    if WDPA_OUT.exists():
        catalog.write_manifest("wdpa", wdpa_datasets(WDPA_OUT))
    else:
        print(f"[skip] {WDPA_OUT} not found")

    if GEONAMES_OUT.exists():
        catalog.write_manifest("geonames", geonames_datasets(GEONAMES_OUT))
    else:
        print(f"[skip] {GEONAMES_OUT} not found")
