import io
import json
import tempfile
import zipfile
from pathlib import Path

import geopandas as gpd
import requests

from ..process import normalize, keep_fields, write_topojson, bbox_of
from .base import DataSource, DatasetMeta

# GADM 4.1 global GeoPackage (all levels in one file, ~800MB uncompressed)
# We use the individual-level shapefiles which are more manageable
GADM_VERSION = "4.1"
BASE = f"https://geodata.ucdavis.edu/gadm/gadm{GADM_VERSION}"

LEVELS = [
    {
        "level": 0,
        "name": "Countries (GADM)",
        "description": "World country boundaries from GADM. More comprehensive coverage than Natural Earth for some regions.",
        "fields": ["GID_0", "COUNTRY"],
        "tags": ["countries", "world", "admin-0", "boundaries", "gadm"],
        "out": "gadm/admin-0.topojson",
        "object_name": "admin0",
    },
    {
        "level": 1,
        "name": "Regions / Provinces (GADM)",
        "description": "First-level administrative divisions for all countries worldwide. Comprehensive global coverage.",
        "fields": ["GID_0", "GID_1", "COUNTRY", "NAME_1", "TYPE_1", "ENGTYPE_1"],
        "tags": ["provinces", "regions", "world", "admin-1", "boundaries", "gadm"],
        "out": "gadm/admin-1.topojson",
        "object_name": "admin1",
    },
    {
        "level": 2,
        "name": "Districts / Counties (GADM)",
        "description": "Second-level administrative divisions for all countries worldwide.",
        "fields": ["GID_0", "GID_1", "GID_2", "COUNTRY", "NAME_1", "NAME_2", "TYPE_2", "ENGTYPE_2"],
        "tags": ["districts", "counties", "world", "admin-2", "detailed", "boundaries", "gadm"],
        "out": "gadm/admin-2.topojson",
        "object_name": "admin2",
    },
]


def _download_level(level: int) -> gpd.GeoDataFrame:
    # GADM provides per-level shapefiles
    url = f"{BASE}/gadm{GADM_VERSION.replace('.', '')}_level{level}.zip"
    print(f"  Downloading GADM level {level} from {url}...")
    r = requests.get(url, timeout=300, stream=True)
    r.raise_for_status()

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        zip_path = tmp_path / "gadm.zip"
        with open(zip_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)

        zipfile.ZipFile(zip_path).extractall(tmp_path)
        candidates = list(tmp_path.glob("**/*.shp")) + list(tmp_path.glob("**/*.gpkg"))
        if not candidates:
            raise ValueError("No spatial file found in GADM zip")
        return gpd.read_file(candidates[0])


class Gadm(DataSource):
    def fetch(self) -> list[DatasetMeta]:
        results = []
        for d in LEVELS:
            out_path = self.output_dir / d["out"]
            print(f"[gadm] {d['name']}")
            try:
                gdf = _download_level(d["level"])
                gdf = normalize(gdf)
                gdf = keep_fields(gdf, d["fields"])
                count = write_topojson(gdf, out_path, object_name=d["object_name"])
                results.append(DatasetMeta(
                    id=f"gadm/admin-{d['level']}",
                    name=d["name"],
                    description=d["description"],
                    source="gadm",
                    source_name="GADM",
                    admin_level=d["level"],
                    region="world",
                    license="gadm-non-commercial",
                    tags=d["tags"],
                    file_path=str(out_path.relative_to(self.output_dir)),
                    feature_count=count,
                    bbox=[-180, -90, 180, 90],
                ))
            except Exception as e:
                print(f"  ERROR: {e}")

        return results
