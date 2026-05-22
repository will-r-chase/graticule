"""
Eurostat GISCO — https://gisco-services.ec.europa.eu
NUTS (Nomenclature of Territorial Units for Statistics) regions.
License: CC BY 4.0
"""

import tempfile
import time
from pathlib import Path

import geopandas as gpd
import requests

from ..process import normalize, keep_fields, write_topojson, bbox_of
from .base import DataSource, DatasetMeta

YEAR = "2021"
SCALE = "10M"
BASE = "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson"

LEVELS = [
    dict(
        level=1,
        name="NUTS 1 — Major Regions",
        description="EU NUTS level 1 major socio-economic regions.",
        tags=["nuts", "europe", "eu", "regions", "admin-1", "boundaries"],
    ),
    dict(
        level=2,
        name="NUTS 2 — Basic Regions",
        description="EU NUTS level 2 basic regions for application of regional policies.",
        tags=["nuts", "europe", "eu", "regions", "admin-2", "boundaries"],
    ),
    dict(
        level=3,
        name="NUTS 3 — Small Regions",
        description="EU NUTS level 3 small regions. Most detailed NUTS breakdown.",
        tags=["nuts", "europe", "eu", "regions", "admin-3", "detailed", "boundaries"],
    ),
]

FIELDS = ["NUTS_ID", "LEVL_CODE", "CNTR_CODE", "NAME_LATN", "NUTS_NAME"]


class Eurostat(DataSource):
    def fetch(self) -> list[DatasetMeta]:
        results = []
        total = len(LEVELS)

        for i, d in enumerate(LEVELS, 1):
            level = d["level"]
            url = f"{BASE}/NUTS_RG_{SCALE}_{YEAR}_4326_LEVL_{level}.geojson"
            out_path = self.output_dir / f"eurostat/nuts-{level}.topojson"

            print(f"\n  [{i}/{total}] {d['name']}", flush=True)
            print(f"      URL: {url}", flush=True)
            t0 = time.time()
            try:
                print(f"      Downloading...", flush=True)
                r = requests.get(url, timeout=60)
                r.raise_for_status()
                kb = len(r.content) // 1024
                print(f"      {kb:,}KB received", flush=True)

                with tempfile.TemporaryDirectory() as tmp:
                    p = Path(tmp) / "nuts.geojson"
                    p.write_bytes(r.content)
                    gdf = gpd.read_file(p)

                print(f"      Read {len(gdf):,} features", flush=True)
                gdf = normalize(gdf)
                gdf = keep_fields(gdf, FIELDS)
                count = write_topojson(gdf, out_path, object_name=f"nuts{level}")
                elapsed = time.time() - t0
                print(f"      ✓ Complete in {elapsed:.1f}s", flush=True)

                results.append(DatasetMeta(
                    id=f"eurostat/nuts-{level}",
                    name=d["name"],
                    description=d["description"],
                    source="eurostat",
                    source_name="Eurostat GISCO",
                    admin_level=level,
                    region="europe",
                    license="cc-by-4.0",
                    tags=d["tags"],
                    file_path=str(out_path.relative_to(self.output_dir)),
                    feature_count=count,
                    bbox=bbox_of(gdf),
                ))
            except Exception as e:
                elapsed = time.time() - t0
                print(f"      ✗ ERROR after {elapsed:.1f}s: {e}", flush=True)

        return results
