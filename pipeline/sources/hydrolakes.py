"""
HydroLAKES — global lake & reservoir polygons from HydroSHEDS — https://www.hydrosheds.org
License: free for non-commercial and commercial use; attribution/citation requested
(Messager et al. (2016), Nature Communications 7:13603).

Distributed as ONE global shapefile (1,427,688 polygons, floored at 0.1 km²) with
no regional tiles — so we split by the `Continent` attribute (6 values). Unlike
rivers, lake shorelines are digitized at ~30m and are wildly over-detailed for a
base map (the Caspian/Great Lakes alone are tens of MB), so we DO simplify: a 500m
interval (still ~3x finer than Natural Earth 1:10m) cuts the largest tile — North
America, 994k lakes, ~60% of the dataset — from a ~1GB string-cap risk to ~24MB
brotli. That makes a clean per-continent split viable with no size-tiering. See
memory [[project_hydrolakes]] for the sizing analysis.

`keep-shapes` stops the smallest lakes collapsing under simplification. `-clean
allow-overlaps` (to repair simplification self-intersections) is intentionally
NOT applied: lakes don't overlap each other, quantization + keep-shapes handle the
within-ring case, and clean is very slow on ~1M polygons. Add it later per-continent
only if self-intersection artifacts appear in the app.

Processed as a one-off (see run_hydrolakes_once.py), not part of the regular
pipeline run — the single global zip is downloaded manually into
pipeline/raw_data/hydrolakes/.
"""

import json
import os
import subprocess
import time
import zipfile
from pathlib import Path

from .base import DataSource, DatasetMeta

HYDROLAKES_DIR = Path(__file__).parent.parent / "raw_data/hydrolakes"

MAPSHAPER_ENV = {**os.environ, "NODE_OPTIONS": "--max-old-space-size=8192"}

# 500m interval — finer than Natural Earth 1:10m (~1.8km vertex spacing), far
# below the 30m source. keep-shapes prevents 0.1km² lakes collapsing. See docstring.
SIMPLIFY_INTERVAL = "500m"

# 5 of the 21 attributes. Hylak_id = identity; Lake_area = size (km², the styling
# lever); Lake_type = 1 lake / 2 reservoir / 3 regulated; Depth_avg = avg depth;
# Lake_name = label (only populated for lakes ≥500km² and named reservoirs, ~0.2%).
KEEP_FIELDS = "Hylak_id,Lake_name,Lake_area,Lake_type,Depth_avg"

# `Continent` field value -> (display name, catalog `region` value / filename slug)
CONTINENTS = {
    "Africa": ("Africa", "africa"),
    "Asia": ("Asia", "asia"),
    "Europe": ("Europe", "europe"),
    "North America": ("North America", "north-america"),
    "South America": ("South America", "south-america"),
    "Oceania": ("Oceania", "oceania"),
}


def _convert_continent(shp_path: Path, continent: str, out_path: Path, timeout: int = 1800) -> tuple[int, list[float]]:
    """Filter one continent's lakes, simplify, and write a TopoJSON layer.
    Returns (feature_count, bbox)."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    args = [
        "mapshaper", str(shp_path),
        "-filter", f'Continent=="{continent}"',
        "-filter-fields", KEEP_FIELDS,
        "-simplify", f"interval={SIMPLIFY_INTERVAL}", "keep-shapes",
        "-rename-layers", "lakes",
        "-o", str(out_path), "format=topojson", "quantization=1000000", "bbox",
    ]
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=MAPSHAPER_ENV)
    if result.returncode != 0:
        lines = [l for l in result.stderr.splitlines() if l.strip()]
        signal = next((l for l in lines if "Error" in l or "FATAL" in l), lines[-1] if lines else "unknown error")
        raise RuntimeError(signal.strip())
    with open(out_path) as f:
        topo = json.load(f)
    count = len(topo["objects"]["lakes"]["geometries"])
    return count, topo.get("bbox", [-180, -90, 180, 90])


class HydroLakes(DataSource):
    def fetch(self) -> list[DatasetMeta]:
        if not HYDROLAKES_DIR.exists():
            print(f"[hydrolakes] WARNING: {HYDROLAKES_DIR} not found, skipping", flush=True)
            return []

        zips = list(HYDROLAKES_DIR.glob("HydroLAKES_polys_v10_shp.zip"))
        if not zips:
            print(f"[hydrolakes] WARNING: no zip found in {HYDROLAKES_DIR}, skipping", flush=True)
            return []

        extracted = HYDROLAKES_DIR / "_extracted"
        shp = next(iter(extracted.glob("**/HydroLAKES_polys_v10.shp")), None)
        if shp is None:
            print(f"\n  Extracting {zips[0].name}...", flush=True)
            with zipfile.ZipFile(zips[0]) as z:
                z.extractall(extracted)
            shp = next(iter(extracted.glob("**/HydroLAKES_polys_v10.shp")), None)
        if shp is None:
            print("[hydrolakes] WARNING: no .shp found after extraction, skipping", flush=True)
            return []

        results = []
        t0 = time.time()
        for continent, (display, region) in CONTINENTS.items():
            out_path = self.output_dir / f"hydrolakes/{region}.topojson"
            if out_path.exists():
                with open(out_path) as f:
                    topo = json.load(f)
                count = len(topo["objects"]["lakes"]["geometries"])
                bbox = topo.get("bbox", [-180, -90, 180, 90])
                print(f"\n  {display} already converted, reusing ({count:,} lakes)", flush=True)
            else:
                print(f"\n  Converting {display}...", flush=True)
                t1 = time.time()
                try:
                    count, bbox = _convert_continent(shp, continent, out_path)
                except Exception as e:
                    print(f"      ✗ FAILED: {e}", flush=True)
                    continue
                size_mb = out_path.stat().st_size / 1048576
                print(f"      Done: {count:,} lakes, {size_mb:.1f}MB in {time.time() - t1:.1f}s", flush=True)

            results.append(DatasetMeta(
                id=f"hydrolakes/{region}",
                name=f"Lakes — {display}",
                description=(
                    f"Lake and reservoir polygons for {display} from HydroLAKES "
                    f"(HydroSHEDS), simplified to ~500m. Each lake carries surface area "
                    f"(km²), type (lake/reservoir/regulated), average depth, and name "
                    f"(major lakes only)."
                ),
                source="hydrolakes",
                source_name="HydroLAKES",
                admin_level=0,
                region=region,
                license="free (attribution)",
                tags=["lakes", "water", "hydrology", "hydrosheds", "polygons", region],
                file_path=f"hydrolakes/{region}.topojson",
                feature_count=count,
                bbox=bbox,
                geometry_type="Polygon",
            ))

        print(f"\n  ✓ HydroLAKES complete in {time.time() - t0:.1f}s "
              f"({len(results)} continent(s))", flush=True)
        return results
