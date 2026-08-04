"""
HydroLAKES — global lake & reservoir polygons from HydroSHEDS — https://www.hydrosheds.org
License: free for non-commercial and commercial use; attribution/citation requested
(Messager et al. (2016), Nature Communications 7:13603).

Distributed as ONE global shapefile (1,427,688 polygons, floored at 0.1 km²).
Lake shorelines are digitized at ~30m and are wildly over-detailed for a base map,
so we simplify to a 500m interval (still ~3x finer than Natural Earth 1:10m).

Broken into SIZE TIERS by Lake_area, not one file per continent:
  - Major (>=100 km²)   -> one global file      (~0.6MB br; 1,708 lakes)
  - Mid   (10-100 km²)  -> one global file      (~0.9MB br; 14,981 lakes)
  - Minor (<10 km²)     -> one file per continent (the ~1.4M-lake bulk)
The big tiers are tiny globally, so only the minor bulk needs per-continent
splitting. See memory [[project_hydrolakes]] for the sizing analysis.

`keep-shapes` stops the smallest lakes collapsing under simplification. `-clean`
is intentionally not applied (lakes don't overlap; slow on ~1M polys).

Processed as a one-off (see run_hydrolakes_once.py). The single global zip is
downloaded manually into pipeline/raw_data/hydrolakes/.
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

SIMPLIFY_INTERVAL = "500m"

# 5 of the 21 attributes. Hylak_id = identity; Lake_area = size (km², styling
# lever); Lake_type = 1 lake / 2 reservoir / 3 regulated; Depth_avg = avg depth;
# Lake_name = label (only populated for lakes ≥500km² and named reservoirs).
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


def _convert(shp_path: Path, filter_expr: str, out_path: Path, timeout: int = 1800) -> tuple[int, list[float]]:
    """Filter the global lake shapefile by `filter_expr`, simplify, write TopoJSON.
    Returns (feature_count, bbox)."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    args = [
        "mapshaper", str(shp_path),
        "-filter", filter_expr,
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


def _dataset(id_: str, name: str, description: str, region: str, file_path: str,
             count: int, bbox: list[float]) -> DatasetMeta:
    return DatasetMeta(
        id=id_, name=name, description=description,
        source="hydrolakes", source_name="HydroLAKES",
        admin_level=0, region=region, license="free (attribution)",
        tags=["lakes", "water", "hydrology", "hydrosheds", "polygons", region],
        file_path=file_path, feature_count=count, bbox=bbox, geometry_type="Polygon",
    )


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

        def build(label, out_path, filter_expr, meta_fn):
            if out_path.exists():
                with open(out_path) as f:
                    topo = json.load(f)
                count = len(topo["objects"]["lakes"]["geometries"])
                bbox = topo.get("bbox", [-180, -90, 180, 90])
                print(f"\n  {label} already built, reusing ({count:,} lakes)", flush=True)
            else:
                print(f"\n  Building {label}...", flush=True)
                t1 = time.time()
                count, bbox = _convert(shp, filter_expr, out_path)
                print(f"      Done: {count:,} lakes, {out_path.stat().st_size / 1048576:.1f}MB "
                      f"in {time.time() - t1:.1f}s", flush=True)
            results.append(meta_fn(count, bbox))

        # Major (>=100 km²) and Mid (10-100 km²) — single global files.
        build("Major lakes", self.output_dir / "hydrolakes/major.topojson", "Lake_area>=100",
              lambda c, b: _dataset(
                  "hydrolakes/major", "Major lakes",
                  "Large lakes and reservoirs worldwide (≥100 km²) from HydroLAKES, "
                  "simplified to ~500m.", "world", "hydrolakes/major.topojson", c, b))
        build("Mid lakes", self.output_dir / "hydrolakes/mid.topojson", "Lake_area>=10 && Lake_area<100",
              lambda c, b: _dataset(
                  "hydrolakes/mid", "Mid lakes",
                  "Medium lakes and reservoirs worldwide (10–100 km²) from HydroLAKES, "
                  "simplified to ~500m.", "world", "hydrolakes/mid.topojson", c, b))

        # Minor (<10 km²) — one file per continent (the ~1.4M-lake bulk).
        for continent, (display, region) in CONTINENTS.items():
            build(f"Minor lakes — {display}", self.output_dir / f"hydrolakes/minor/{region}.topojson",
                  f'Lake_area<10 && Continent=="{continent}"',
                  lambda c, b, display=display, region=region: _dataset(
                      f"hydrolakes/minor-{region}", f"Minor lakes — {display}",
                      f"Small lakes and reservoirs in {display} (<10 km²) from HydroLAKES, "
                      f"simplified to ~500m.", region, f"hydrolakes/minor/{region}.topojson", c, b))

        print(f"\n  ✓ HydroLAKES complete in {time.time() - t0:.1f}s ({len(results)} datasets)", flush=True)
        return results
