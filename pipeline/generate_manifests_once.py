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
from .sources.base import DatasetMeta, LayerMeta
from .sources.geonames import CATEGORY_DISPLAY_NAMES, GROUPS
from .sources.wdpa import IUCN_CAT_NAMES, _dataset_from_topojson

WDPA_OUT = Path(__file__).parent / "raw_data/wdpa/output"
GEONAMES_OUT = Path(__file__).parent / "raw_data/geonames/output"


def _union_bbox(acc, bbox):
    if bbox is None:
        return acc
    if acc is None:
        return list(bbox)
    return [min(acc[0], bbox[0]), min(acc[1], bbox[1]),
            max(acc[2], bbox[2]), max(acc[3], bbox[3])]


def wdpa_datasets(output_dir: Path) -> list[DatasetMeta]:
    datasets = []

    points_path = output_dir / "wdpa/points.topojson"
    if points_path.exists():
        datasets.append(_dataset_from_topojson(
            points_path, output_dir, "wdpa/points", "Protected Areas (Points)",
            "Protected areas reported without boundary geometry, as center points, "
            "split by IUCN management category.",
            ["protected-areas", "conservation", "world", "points"],
        ))

    # slug (on-disk object name) -> human display name. Standard categories map
    # back through IUCN_CAT_NAMES; the Unclassified_<realm> splits become
    # "Unclassified — <realm>", matching WDPA.fetch()'s naming.
    slug_display = {}
    for iucn, slug in SLUGS.items():
        if iucn in IUCN_CAT_NAMES:
            slug_display[slug] = IUCN_CAT_NAMES[iucn]
        else:
            slug_display[slug] = f"Unclassified — {iucn.split('_', 1)[1]}"

    poly_dir = output_dir / "wdpa/polygons"
    layers, total_count, total_bbox = [], 0, None
    for p in sorted(poly_dir.glob("*.topojson")):
        topo = json.load(open(p))
        for object_name, obj in topo["objects"].items():
            layers.append(LayerMeta(
                name=slug_display.get(object_name, object_name),
                object_name=object_name,
                file_path=str(p.relative_to(output_dir)),
            ))
            total_count += len(obj["geometries"])
        total_bbox = _union_bbox(total_bbox, topo.get("bbox"))

    if layers:
        datasets.append(DatasetMeta(
            id="wdpa/polygons",
            name="Protected Areas (Polygons)",
            description="Terrestrial and marine protected area boundaries, "
                        "split by IUCN management category.",
            source="wdpa",
            source_name="WDPA",
            admin_level=0,
            region="world",
            license="non-commercial",
            tags=["protected-areas", "conservation", "world", "polygons"],
            file_path="wdpa/polygons",
            feature_count=total_count,
            bbox=total_bbox or [-180, -90, 180, 90],
            layers=layers,
        ))
    return datasets


def geonames_datasets(output_dir: Path) -> list[DatasetMeta]:
    datasets = []
    for group, meta in GROUPS.items():
        group_dir = output_dir / "geonames" / group
        if not group_dir.exists():
            continue
        layers, total_count, total_bbox = [], 0, None
        for csv in sorted(group_dir.glob("*.csv")):
            category = csv.stem
            df = pd.read_csv(csv, usecols=["latitude", "longitude"])
            lon = pd.to_numeric(df["longitude"], errors="coerce")
            lat = pd.to_numeric(df["latitude"], errors="coerce")
            bbox = [float(lon.min()), float(lat.min()), float(lon.max()), float(lat.max())]
            layers.append(LayerMeta(
                name=CATEGORY_DISPLAY_NAMES[group].get(category, category),
                object_name=category,
                file_path=str(csv.relative_to(output_dir)),
                geometry_type="Point",
            ))
            total_count += len(df)
            total_bbox = _union_bbox(total_bbox, bbox)

        if layers:
            datasets.append(DatasetMeta(
                id=f"geonames/{group.replace('_', '-')}",
                name=meta["name"],
                description=meta["description"],
                source="geonames",
                source_name="GeoNames",
                admin_level=0,
                region="world",
                license="CC-BY 4.0",
                tags=meta["tags"],
                file_path=f"geonames/{group}",
                feature_count=total_count,
                bbox=total_bbox or [-180, -90, 180, 90],
                layers=layers,
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
