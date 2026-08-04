"""
HydroRIVERS — global river network from HydroSHEDS — https://www.hydrosheds.org
License: free for non-commercial and commercial use; attribution/citation
requested (Lehner, B., Grill G. (2013), Hydrological Processes 27(15): 2171–2186).

Distributed as per-region shapefile tiles (af/ar/as/au/eu/gr/na/sa/si). Broken
into SIZE TIERS by ORD_FLOW (flow-based river order, 1 = biggest):
  - Major (ORD_FLOW <= 4, ≥100 m³/s) -> one GLOBAL file (~7MB br; 273k reaches)
  - Mid   (ORD_FLOW == 5, ≥10 m³/s)  -> one GLOBAL file (~15MB br)
  - Minor (ORD_FLOW >= 6)            -> one file per region (the multi-million bulk)
The big tiers are small enough to serve globally; only the minor bulk stays split
by region. (ORD_FLOW 6 alone is ~1.5M reaches, which is why it sits in minor, not
mid.) No simplification — full detail. See memory [[project_hydrorivers]].

Processed as a one-off (see run_hydrorivers_once.py). Regional zips are downloaded
manually into pipeline/raw_data/hydrorivers/.
"""

import json
import os
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path

from .base import DataSource, DatasetMeta

HYDRORIVERS_DIR = Path(__file__).parent.parent / "raw_data/hydrorivers"

MAPSHAPER_ENV = {**os.environ, "NODE_OPTIONS": "--max-old-space-size=8192"}

# 6 of the 14 source attributes — see [[project_hydrorivers]] for why each.
KEEP_FIELDS = "HYRIV_ID,LENGTH_KM,UPLAND_SKM,DIS_AV_CMS,ORD_CLAS,ORD_FLOW"

# region code -> (display name, catalog `region` value)
REGIONS = {
    "af": ("Africa", "africa"),
    "ar": ("Arctic (North America)", "arctic"),
    "as": ("Asia (Central & South-East)", "asia"),
    "au": ("Australasia", "australasia"),
    "eu": ("Europe & Middle East", "europe"),
    "gr": ("Greenland", "greenland"),
    "na": ("North America & Caribbean", "north-america"),
    "sa": ("South America", "south-america"),
    "si": ("Siberia", "siberia"),
}


def _signal(stderr: str) -> str:
    lines = [l for l in stderr.splitlines() if l.strip()]
    return next((l for l in lines if "Error" in l or "FATAL" in l), lines[-1] if lines else "unknown error").strip()


def _count_bbox(out_path: Path) -> tuple[int, list[float]]:
    with open(out_path) as f:
        topo = json.load(f)
    return len(topo["objects"]["rivers"]["geometries"]), topo.get("bbox", [-180, -90, 180, 90])


def _build_global_tier(region_shps: list[Path], filter_expr: str, out_path: Path, timeout: int = 1800) -> tuple[int, list[float]]:
    """Filter each region shapefile by `filter_expr` and merge into one global
    TopoJSON. Filtering to shapefiles first (cheap, no topology) then merging once
    keeps topology-building to a single pass."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        parts = []
        for shp in region_shps:
            part = tmp / f"{shp.stem}.shp"
            r = subprocess.run(["mapshaper", str(shp), "-filter", filter_expr, "-filter-fields", KEEP_FIELDS,
                                "-o", str(part), "format=shapefile"],
                               capture_output=True, text=True, env=MAPSHAPER_ENV, timeout=timeout)
            if r.returncode != 0:
                raise RuntimeError(_signal(r.stderr))
            if part.exists():
                parts.append(part)
        args = ["mapshaper"]
        names = []
        for i, p in enumerate(parts):
            args += ["-i", str(p), f"name=r{i}"]
            names.append(f"r{i}")
        args += ["-merge-layers", f"target={','.join(names)}", "force", "name=rivers",
                 "-o", str(out_path), "format=topojson", "quantization=1000000", "bbox"]
        r = subprocess.run(args, capture_output=True, text=True, env=MAPSHAPER_ENV, timeout=timeout)
        if r.returncode != 0:
            raise RuntimeError(_signal(r.stderr))
    return _count_bbox(out_path)


def _build_region_tier(shp: Path, filter_expr: str, out_path: Path, timeout: int = 900) -> tuple[int, list[float]]:
    """Filter one region shapefile by `filter_expr` into its own TopoJSON layer."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    args = ["mapshaper", str(shp), "-filter", filter_expr, "-filter-fields", KEEP_FIELDS,
            "-rename-layers", "rivers", "-o", str(out_path), "format=topojson",
            "quantization=1000000", "bbox"]
    r = subprocess.run(args, capture_output=True, text=True, env=MAPSHAPER_ENV, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(_signal(r.stderr))
    return _count_bbox(out_path)


def _dataset(id_: str, name: str, description: str, region: str, file_path: str,
             count: int, bbox: list[float]) -> DatasetMeta:
    return DatasetMeta(
        id=id_, name=name, description=description,
        source="hydrorivers", source_name="HydroRIVERS",
        admin_level=0, region=region, license="free (attribution)",
        tags=["rivers", "water", "hydrology", "hydrosheds", "lines", region],
        file_path=file_path, feature_count=count, bbox=bbox, geometry_type="LineString",
    )


class HydroRivers(DataSource):
    def fetch(self) -> list[DatasetMeta]:
        if not HYDRORIVERS_DIR.exists():
            print(f"[hydrorivers] WARNING: {HYDRORIVERS_DIR} not found, skipping", flush=True)
            return []

        extracted = HYDRORIVERS_DIR / "_extracted"
        region_shps: dict[str, Path] = {}
        for code in REGIONS:
            zips = list(HYDRORIVERS_DIR.glob(f"HydroRIVERS_v10_{code}_shp.zip"))
            if not zips:
                continue
            shp = next(iter(extracted.glob(f"**/HydroRIVERS_v10_{code}.shp")), None)
            if shp is None:
                print(f"\n  Extracting {zips[0].name}...", flush=True)
                with zipfile.ZipFile(zips[0]) as z:
                    z.extractall(extracted / code)
                shp = next(iter((extracted / code).glob(f"**/HydroRIVERS_v10_{code}.shp")), None)
            if shp is not None:
                region_shps[code] = shp

        if not region_shps:
            print(f"[hydrorivers] WARNING: no region shapefiles in {HYDRORIVERS_DIR}, skipping", flush=True)
            return []

        results = []
        t0 = time.time()
        all_shps = list(region_shps.values())

        def reuse_or_build(label, out_path, builder, meta_fn):
            if out_path.exists():
                count, bbox = _count_bbox(out_path)
                print(f"\n  {label} already built, reusing ({count:,} reaches)", flush=True)
            else:
                print(f"\n  Building {label}...", flush=True)
                t1 = time.time()
                count, bbox = builder()
                print(f"      Done: {count:,} reaches, {out_path.stat().st_size / 1048576:.1f}MB "
                      f"in {time.time() - t1:.1f}s", flush=True)
            results.append(meta_fn(count, bbox))

        # Major (ORD_FLOW <= 4) and Mid (ORD_FLOW == 5) — global, merged across regions.
        reuse_or_build(
            "Major rivers", self.output_dir / "hydrorivers/major.topojson",
            lambda: _build_global_tier(all_shps, "ORD_FLOW<=4", self.output_dir / "hydrorivers/major.topojson"),
            lambda c, b: _dataset("hydrorivers/major", "Major rivers",
                                  "The world's major rivers (long-term discharge ≥100 m³/s) from "
                                  "HydroRIVERS, full detail.", "world", "hydrorivers/major.topojson", c, b))
        reuse_or_build(
            "Mid rivers", self.output_dir / "hydrorivers/mid.topojson",
            lambda: _build_global_tier(all_shps, "ORD_FLOW==5", self.output_dir / "hydrorivers/mid.topojson"),
            lambda c, b: _dataset("hydrorivers/mid", "Mid rivers",
                                  "Mid-sized rivers worldwide (discharge ~10–100 m³/s) from "
                                  "HydroRIVERS, full detail.", "world", "hydrorivers/mid.topojson", c, b))

        # Minor (ORD_FLOW >= 6) — per region (the multi-million-reach bulk).
        for code, (display, region) in REGIONS.items():
            if code not in region_shps:
                continue
            out_path = self.output_dir / f"hydrorivers/minor/{code}.topojson"
            reuse_or_build(
                f"Minor rivers — {display}", out_path,
                lambda out_path=out_path, code=code: _build_region_tier(region_shps[code], "ORD_FLOW>=6", out_path),
                lambda c, b, display=display, region=region, code=code: _dataset(
                    f"hydrorivers/minor-{code}", f"Minor rivers — {display}",
                    f"Small rivers and streams in {display} (discharge <10 m³/s) from "
                    f"HydroRIVERS, full detail.", region, f"hydrorivers/minor/{code}.topojson", c, b))

        print(f"\n  ✓ HydroRIVERS complete in {time.time() - t0:.1f}s ({len(results)} datasets)", flush=True)
        return results
