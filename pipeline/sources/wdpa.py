"""
WDPA — World Database on Protected Areas — https://www.protectedplanet.net
License: non-commercial use only (UNEP-WCMC terms).

Distributed as a single zip containing 3 inner zips (arbitrarily split for
file size, not by geometry type). Each inner zip has a polygon shapefile
and a point shapefile; the 3 polygon shapefiles need to be merged into one
layer, and likewise for the 3 point shapefiles.

Processed directly through the mapshaper CLI rather than geopandas — at
~300k complex polygons, geopandas is far slower. Converting the whole
merged polygon set to TopoJSON in one pass also blows past mapshaper's
memory limits: building topology (even the "no-topology" shared-file import
that `combine-files` does) over 300k features — or even over the 95k-feature
IUCN Category IV subset alone — needs several GB of Node heap. So each raw
part is first split by IUCN_CAT (cheap, no topology needed, plain Shapefile
output), and only the much smaller per-category groups are merged into
TopoJSON, each as its own layer/file.
"""

import json
import os
import subprocess
import time
import zipfile
from pathlib import Path

from .base import DataSource, DatasetMeta, LayerMeta

WDPA_DIR = Path(__file__).parent.parent / "raw_data/wdpa"

MAPSHAPER_ENV = {**os.environ, "NODE_OPTIONS": "--max-old-space-size=8192"}

# Buckets records with no reported/assigned category into one layer.
IUCN_CAT_EXPR = (
    'IUCN_CAT = (IUCN_CAT=="Not Reported" || IUCN_CAT=="Not Assigned" '
    '|| IUCN_CAT=="Not Applicable") ? "Unclassified" : IUCN_CAT'
)

IUCN_CAT_NAMES = {
    "Ia": "Ia — Strict Nature Reserve",
    "Ib": "Ib — Wilderness Area",
    "II": "II — National Park",
    "III": "III — Natural Monument",
    "IV": "IV — Habitat/Species Management Area",
    "V": "V — Protected Landscape/Seascape",
    "VI": "VI — Managed Resource Protected Area",
    "Unclassified": "Unclassified",
}


def _split_by_category(shp_path: Path, out_dir: Path) -> None:
    """Attribute-only split, no topology building — plain Shapefile output."""
    out_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "mapshaper", str(shp_path),
            "-each", IUCN_CAT_EXPR,
            "-split", "IUCN_CAT",
            "-o", "format=shapefile", f"{out_dir}/",
        ],
        check=True, capture_output=True, text=True, timeout=600,
    )


def _split_by_field(shp_path: Path, field: str, out_dir: Path) -> None:
    """Attribute-only split on an arbitrary field — plain Shapefile output."""
    out_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["mapshaper", str(shp_path), "-split", field, "-o", "format=shapefile", f"{out_dir}/"],
        check=True, capture_output=True, text=True, timeout=600,
    )


# NE 10m's own vertex spacing measures ~1.8km median / ~3.2km mean, so this
# targets a comparable resolution rather than an arbitrary percentage.
SIMPLIFY_INTERVAL = "1500m"


def _merge_to_topojson(parts: list[Path], object_name: str, out_path: Path, timeout: int = 900) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    args = ["mapshaper"]
    names = []
    for i, p in enumerate(parts):
        n = f"p{i}"
        names.append(n)
        args += ["-i", str(p), f"name={n}"]
    args += ["-merge-layers", f"target={','.join(names)}", "force", f"name={object_name}"]
    # keep-shapes: prevent small protected areas from collapsing to nothing.
    # clean allow-overlaps: repairs the self-intersections aggressive
    # simplification introduces, without dissolving WDPA's legitimate nested/
    # overlapping designations. keep-shapes first means clean only has to
    # drop features that were already fully null, not real data.
    args += ["-simplify", f"interval={SIMPLIFY_INTERVAL}", "keep-shapes", "stats"]
    args += ["-clean", "allow-overlaps"]
    args += ["-o", "format=topojson", "quantization=1000000", "bbox", str(out_path)]
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=MAPSHAPER_ENV)
    if result.returncode != 0:
        # crashes (OOM, V8 string-length cap) dump a huge stack trace — keep
        # just the signal line so retry logs stay readable
        lines = [l for l in result.stderr.splitlines() if l.strip()]
        signal = next((l for l in lines if "Error" in l or "FATAL" in l), lines[-1] if lines else "unknown error")
        raise RuntimeError(signal.strip())


def _chunk_split(shp_path: Path, n_chunks: int, out_dir: Path, chunk_field: str = "SITE_ID") -> None:
    """Arbitrary, order-independent split into N roughly-equal chunks — no
    semantic meaning, just a file-size lever for merges that are still too big."""
    out_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "mapshaper", str(shp_path),
            "-each", f"CHUNK = {chunk_field} % {n_chunks}",
            "-split", "CHUNK",
            "-o", "format=shapefile", f"{out_dir}/",
        ],
        check=True, capture_output=True, text=True, timeout=600,
    )


def _merge_group(parts: list[Path], object_name: str, display_name: str, out_path: Path,
                  output_dir: Path, _depth: int = 0) -> list[tuple[LayerMeta, int, list[float] | None]]:
    """Merge one group's per-part Shapefiles into a TopoJSON layer.

    If the merge fails — either an out-of-memory Node crash or V8's ~1GB
    single-string cap during JSON export — the group is too big for a single
    TopoJSON file regardless of available RAM. Falls back to splitting each
    part into 2 arbitrary chunks (by SITE_ID, no semantic meaning) and
    retrying each half separately, recursively, so any oversized bucket
    (this run or a future WDPA update) self-heals without manual tuning.

    Returns a list of (layer_meta, feature_count, bbox) — more than one
    entry if a fallback split occurred.
    """
    print(f"\n  Merging {out_path.stem} ({len(parts)} parts)...", flush=True)
    t1 = time.time()
    try:
        _merge_to_topojson(parts, object_name, out_path)
    except Exception as e:
        if _depth >= 4:
            print(f"      ✗ Giving up after {_depth} chunk splits: {e}", flush=True)
            return []
        print(f"      ✗ Failed ({e}) — splitting into 2 chunks and retrying...", flush=True)
        chunk_dirs = []
        for i, p in enumerate(parts):
            chunk_dir = p.parent / f"{p.stem}_chunk{_depth}"
            if not list(chunk_dir.glob("*.shp")):
                _chunk_split(p, 2, chunk_dir)
            chunk_dirs.append(chunk_dir)
        results = []
        for c in range(2):
            chunk_parts = [d / f"{c}.shp" for d in chunk_dirs if (d / f"{c}.shp").exists()]
            if not chunk_parts:
                continue
            chunk_object_name = f"{object_name}_{c}"
            chunk_out_path = out_path.parent / f"{chunk_object_name}.topojson"
            chunk_display = f"{display_name} ({c + 1} of 2)"
            results += _merge_group(chunk_parts, chunk_object_name, chunk_display,
                                     chunk_out_path, output_dir, _depth=_depth + 1)
        return results
    with open(out_path) as f:
        topo = json.load(f)
    count = len(topo["objects"][object_name]["geometries"])
    print(f"      Done: {count:,} features, "
          f"{out_path.stat().st_size / 1024 / 1024:.1f}MB in {time.time() - t1:.1f}s", flush=True)
    return [(LayerMeta(name=display_name, object_name=object_name,
                        file_path=str(out_path.relative_to(output_dir))), count, topo.get("bbox"))]


def _dataset_from_topojson(out_path: Path, output_dir: Path, dataset_id: str, name: str,
                            description: str, tags: list[str], top_file_path: str = None) -> DatasetMeta:
    with open(out_path) as f:
        topo = json.load(f)
    layers = [
        LayerMeta(
            name=IUCN_CAT_NAMES.get(cat, cat),
            object_name=cat,
            file_path=str(out_path.relative_to(output_dir)),
        )
        for cat in topo["objects"]
    ]
    feature_count = sum(len(topo["objects"][l.object_name]["geometries"]) for l in layers)
    return DatasetMeta(
        id=dataset_id,
        name=name,
        description=description,
        source="wdpa",
        source_name="WDPA",
        admin_level=0,
        region="world",
        license="non-commercial",
        tags=tags,
        file_path=top_file_path or str(out_path.relative_to(output_dir)),
        feature_count=feature_count,
        bbox=topo.get("bbox", [-180, -90, 180, 90]),
        layers=layers,
    )


class WDPA(DataSource):
    def fetch(self) -> list[DatasetMeta]:
        zips = list(WDPA_DIR.glob("*.zip"))
        if not zips:
            print(f"[wdpa] WARNING: no zip found in {WDPA_DIR}, skipping", flush=True)
            return []

        results = []
        t0 = time.time()
        extracted = WDPA_DIR / "_extracted"
        if list(extracted.glob("**/*-polygons.shp")):
            print(f"\n  {zips[0].name} already extracted, reusing cached files", flush=True)
        else:
            print(f"\n  Extracting {zips[0].name}...", flush=True)
            with zipfile.ZipFile(zips[0]) as outer:
                outer.extractall(extracted)
                for inner_name in outer.namelist():
                    if inner_name.endswith(".zip"):
                        inner_path = extracted / inner_name
                        # each inner zip's shapefiles share the same filenames, so
                        # give every part its own subdirectory to avoid overwriting
                        part_dir = inner_path.parent / inner_path.stem
                        with zipfile.ZipFile(inner_path) as inner:
                            inner.extractall(part_dir)

        poly_shps = sorted(extracted.glob("**/*-polygons.shp"))
        point_shps = sorted(extracted.glob("**/*-points.shp"))
        print(f"      Found {len(poly_shps)} polygon parts, {len(point_shps)} point parts", flush=True)

        # Points: small enough (~8k features) to merge + split by category in one pass.
        if point_shps:
            print("\n  Converting points via mapshaper...", flush=True)
            t1 = time.time()
            out_path = self.output_dir / "wdpa/points.topojson"
            out_path.parent.mkdir(parents=True, exist_ok=True)
            args = ["mapshaper"]
            names = []
            for i, p in enumerate(point_shps):
                n = f"p{i}"
                names.append(n)
                args += ["-i", str(p), f"name={n}"]
            args += ["-merge-layers", f"target={','.join(names)}", "force", "name=wdpa_points"]
            args += ["-each", IUCN_CAT_EXPR, "-split", "IUCN_CAT"]
            args += ["-o", "format=topojson", "quantization=1000000", "bbox", str(out_path)]
            result = subprocess.run(args, capture_output=True, text=True, timeout=300)
            if result.returncode != 0:
                print(f"      ✗ ERROR: {result.stderr.strip()}", flush=True)
            else:
                results.append(_dataset_from_topojson(
                    out_path, self.output_dir, "wdpa/points", "Protected Areas (Points)",
                    "Protected areas reported without boundary geometry, as center points, "
                    "split by IUCN management category.",
                    ["protected-areas", "conservation", "world", "points"],
                ))
                print(f"      Done: {out_path.stat().st_size / 1024 / 1024:.1f}MB in {time.time() - t1:.1f}s", flush=True)

        # Polygons: split each part by category first (cheap, no topology), then
        # merge only within each category — small enough to fit comfortably.
        if poly_shps:
            print(f"\n  Splitting {len(poly_shps)} polygon parts by IUCN_CAT...", flush=True)
            split_dirs = []
            for i, shp in enumerate(poly_shps):
                t1 = time.time()
                split_dir = WDPA_DIR / "_extracted" / f"_poly_split_{i}"
                if list(split_dir.glob("*.shp")):
                    print(f"      Part {i + 1}/{len(poly_shps)} already split, reusing cache", flush=True)
                else:
                    _split_by_category(shp, split_dir)
                    print(f"      Part {i + 1}/{len(poly_shps)} split in {time.time() - t1:.1f}s", flush=True)
                split_dirs.append(split_dir)

            categories = sorted({p.stem for d in split_dirs for p in d.glob("*.shp")})
            print(f"      Categories found: {categories}", flush=True)

            layers = []
            total_bbox = None
            total_count = 0

            def _record(results):
                nonlocal total_bbox, total_count
                for layer, count, bbox in results:
                    layers.append(layer)
                    total_count += count
                    if bbox:
                        total_bbox = bbox if total_bbox is None else [
                            min(total_bbox[0], bbox[0]), min(total_bbox[1], bbox[1]),
                            max(total_bbox[2], bbox[2]), max(total_bbox[3], bbox[3]),
                        ]

            out_dir = self.output_dir / "wdpa/polygons"
            for cat in categories:
                parts = [d / f"{cat}.shp" for d in split_dirs if (d / f"{cat}.shp").exists()]

                if cat == "Unclassified":
                    # Largest single bucket — even on its own this exceeds V8's
                    # ~1GB single-string limit during TopoJSON export. Split
                    # further by REALM so each merge stays well under that cap.
                    print(f"\n  {cat} is too large to merge directly — splitting further by REALM...", flush=True)
                    realm_split_dirs = []
                    for i, p in enumerate(parts):
                        realm_dir = WDPA_DIR / "_extracted" / f"_unclassified_split_{i}"
                        if not list(realm_dir.glob("*.shp")):
                            _split_by_field(p, "REALM", realm_dir)
                        realm_split_dirs.append(realm_dir)
                    realms = sorted({f.stem for d in realm_split_dirs for f in d.glob("*.shp")})
                    for realm in realms:
                        realm_parts = [d / f"{realm}.shp" for d in realm_split_dirs if (d / f"{realm}.shp").exists()]
                        object_name = f"Unclassified_{realm}"
                        out_path = out_dir / f"{object_name}.topojson"
                        _record(_merge_group(realm_parts, object_name, f"Unclassified — {realm}",
                                              out_path, self.output_dir))
                    continue

                out_path = out_dir / f"{cat}.topojson"
                _record(_merge_group(parts, cat, IUCN_CAT_NAMES.get(cat, cat), out_path, self.output_dir))

            if layers:
                results.append(DatasetMeta(
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

        elapsed = time.time() - t0
        print(f"\n  ✓ WDPA complete in {elapsed:.1f}s", flush=True)
        return results
