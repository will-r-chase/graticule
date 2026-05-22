from pathlib import Path

import geopandas as gpd
import requests

from ..process import normalize, keep_fields, write_topojson, bbox_of
from .base import DataSource, DatasetMeta

# Eurostat GISCO GeoJSON API — 10M scale, 2021 boundaries, EPSG:4326
YEAR = "2021"
SCALE = "10M"
BASE = "https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson"

LEVELS = [
    {
        "level": 1,
        "name": "NUTS 1 — Major Regions",
        "description": "EU NUTS level 1 major socio-economic regions (e.g. Germany's federal states grouped into regions).",
        "tags": ["nuts", "europe", "eu", "regions", "admin-1", "boundaries"],
    },
    {
        "level": 2,
        "name": "NUTS 2 — Basic Regions",
        "description": "EU NUTS level 2 basic regions for application of regional policies.",
        "tags": ["nuts", "europe", "eu", "regions", "admin-2", "boundaries"],
    },
    {
        "level": 3,
        "name": "NUTS 3 — Small Regions",
        "description": "EU NUTS level 3 small regions for specific diagnoses. Most detailed NUTS breakdown.",
        "tags": ["nuts", "europe", "eu", "regions", "admin-3", "detailed", "boundaries"],
    },
]

FIELDS = ["NUTS_ID", "LEVL_CODE", "CNTR_CODE", "NAME_LATN", "NUTS_NAME"]


class Eurostat(DataSource):
    def fetch(self) -> list[DatasetMeta]:
        results = []
        for d in LEVELS:
            level = d["level"]
            url = f"{BASE}/NUTS_RG_{SCALE}_{YEAR}_4326_LEVL_{level}.geojson"
            out_path = self.output_dir / f"eurostat/nuts-{level}.topojson"
            print(f"[eurostat] {d['name']}")
            try:
                r = requests.get(url, timeout=60)
                r.raise_for_status()
                import tempfile
                from pathlib import Path as P
                with tempfile.TemporaryDirectory() as tmp:
                    p = P(tmp) / "nuts.geojson"
                    p.write_bytes(r.content)
                    gdf = gpd.read_file(p)

                gdf = normalize(gdf)
                gdf = keep_fields(gdf, FIELDS)
                count = write_topojson(gdf, out_path, object_name=f"nuts{level}")
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
                print(f"  ERROR: {e}")

        return results
