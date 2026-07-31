"""
HydroRIVERS — global river network from HydroSHEDS — https://www.hydrosheds.org
License: free for non-commercial and commercial use; attribution/citation
requested (Lehner, B., Grill G. (2013), Hydrological Processes 27(15): 2171–2186).

Distributed as per-region shapefile tiles (af/ar/as/au/eu/gr/na/sa/si). Each
regional .shp is converted straight to a TopoJSON layer — no simplification and
no size-tier splitting (deferred: Will wants to judge rendering performance on
the full-detail files before deciding whether splitting by river order is
needed). Only a lean 6-of-14 attribute subset is kept; the all-attribute
conversion is ~2x larger, and unsimplified+all-fields overflows V8's ~1GB
single-string cap during TopoJSON export. Trimming to these 6 fields is what
keeps even the largest tile (Africa, 1.53M reaches) at ~316MB, safely under the
cap. See memory [[project_hydrorivers]] for the full sizing analysis.

Processed as a one-off (see run_hydrorivers_once.py), not part of the regular
pipeline run — the regional zips are downloaded manually into
pipeline/raw_data/hydrorivers/.
"""

import json
import os
import subprocess
import time
import zipfile
from pathlib import Path

from .base import DataSource, DatasetMeta

HYDRORIVERS_DIR = Path(__file__).parent.parent / "raw_data/hydrorivers"

MAPSHAPER_ENV = {**os.environ, "NODE_OPTIONS": "--max-old-space-size=8192"}

# 6 of the 14 source attributes. HYRIV_ID = stable identity; ORD_FLOW =
# flow-based log size class (primary style/filter lever); ORD_CLAS = main-stem
# vs tributary order; DIS_AV_CMS = average discharge; UPLAND_SKM = total
# upstream drainage area (smooth line-width lever, robust in arid zones);
# LENGTH_KM = reach length. See [[project_hydrorivers]] for why each was kept.
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


def _convert_region(shp_path: Path, out_path: Path, timeout: int = 900) -> tuple[int, list[float]]:
    """Convert one regional HydroRIVERS shapefile to a trimmed TopoJSON layer.

    No simplification, no split — full-detail geometry, 6 kept fields. Returns
    (feature_count, bbox). Raises RuntimeError with just the signal line if
    mapshaper fails (e.g. the string-cap crash, if a region ever exceeds it).
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    args = [
        "mapshaper", str(shp_path),
        "-filter-fields", KEEP_FIELDS,
        "-rename-layers", "rivers",
        "-o", str(out_path), "format=topojson", "quantization=1000000", "bbox",
    ]
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=MAPSHAPER_ENV)
    if result.returncode != 0:
        lines = [l for l in result.stderr.splitlines() if l.strip()]
        signal = next((l for l in lines if "Error" in l or "FATAL" in l), lines[-1] if lines else "unknown error")
        raise RuntimeError(signal.strip())
    with open(out_path) as f:
        topo = json.load(f)
    count = len(topo["objects"]["rivers"]["geometries"])
    return count, topo.get("bbox", [-180, -90, 180, 90])


class HydroRivers(DataSource):
    def fetch(self) -> list[DatasetMeta]:
        if not HYDRORIVERS_DIR.exists():
            print(f"[hydrorivers] WARNING: {HYDRORIVERS_DIR} not found, skipping", flush=True)
            return []

        results = []
        extracted = HYDRORIVERS_DIR / "_extracted"
        t0 = time.time()

        for code, (display, region) in REGIONS.items():
            zips = list(HYDRORIVERS_DIR.glob(f"HydroRIVERS_v10_{code}_shp.zip"))
            if not zips:
                # region simply not downloaded yet — partial builds are fine
                continue

            shp = next(iter(extracted.glob(f"**/HydroRIVERS_v10_{code}.shp")), None)
            if shp is None:
                print(f"\n  Extracting {zips[0].name}...", flush=True)
                with zipfile.ZipFile(zips[0]) as z:
                    z.extractall(extracted / code)
                shp = next(iter((extracted / code).glob(f"**/HydroRIVERS_v10_{code}.shp")), None)
            if shp is None:
                print(f"[hydrorivers] WARNING: no .shp found for {code}, skipping", flush=True)
                continue

            out_path = self.output_dir / f"hydrorivers/{code}.topojson"
            if out_path.exists():
                with open(out_path) as f:
                    topo = json.load(f)
                count = len(topo["objects"]["rivers"]["geometries"])
                bbox = topo.get("bbox", [-180, -90, 180, 90])
                print(f"\n  {display} ({code}) already converted, reusing "
                      f"({count:,} reaches)", flush=True)
            else:
                print(f"\n  Converting {display} ({code})...", flush=True)
                t1 = time.time()
                try:
                    count, bbox = _convert_region(shp, out_path)
                except Exception as e:
                    print(f"      ✗ FAILED: {e}", flush=True)
                    continue
                size_mb = out_path.stat().st_size / 1048576
                print(f"      Done: {count:,} reaches, {size_mb:.1f}MB "
                      f"in {time.time() - t1:.1f}s", flush=True)

            results.append(DatasetMeta(
                id=f"hydrorivers/{code}",
                name=f"Rivers — {display}",
                description=(
                    f"Full-detail river network for {display} from HydroRIVERS "
                    f"(HydroSHEDS). Each reach carries flow-based order (ORD_FLOW), "
                    f"main-stem order (ORD_CLAS), average discharge, upstream drainage "
                    f"area, and length."
                ),
                source="hydrorivers",
                source_name="HydroRIVERS",
                admin_level=0,
                region=region,
                license="free (attribution)",
                tags=["rivers", "water", "hydrology", "hydrosheds", "lines", region],
                file_path=f"hydrorivers/{code}.topojson",
                feature_count=count,
                bbox=bbox,
                geometry_type="LineString",
            ))

        print(f"\n  ✓ HydroRIVERS complete in {time.time() - t0:.1f}s "
              f"({len(results)} region(s))", flush=True)
        return results
