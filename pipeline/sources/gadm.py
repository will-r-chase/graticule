import tempfile
import zipfile
from pathlib import Path

import geopandas as gpd
import requests

from ..process import normalize, keep_fields, write_topojson, bbox_of
from .base import DataSource, DatasetMeta

# GADM 4.1 — single GeoPackage containing all admin levels as separate layers
GADM_VERSION = "4.1"
GADM_URL = f"https://geodata.ucdavis.edu/gadm/gadm{GADM_VERSION}/gadm_410-levels.zip"

# Layer names inside the GeoPackage
LEVELS = [
    {
        "level": 0,
        "layer": "ADM_0",
        "name": "Countries (GADM)",
        "description": "World country boundaries from GADM. More comprehensive coverage than Natural Earth for some regions.",
        "fields": ["GID_0", "COUNTRY"],
        "tags": ["countries", "world", "admin-0", "boundaries", "gadm"],
        "out": "gadm/admin-0.topojson",
        "object_name": "admin0",
    },
    {
        "level": 1,
        "layer": "ADM_1",
        "name": "Regions / Provinces (GADM)",
        "description": "First-level administrative divisions for all countries worldwide. Comprehensive global coverage.",
        "fields": ["GID_0", "GID_1", "COUNTRY", "NAME_1", "TYPE_1", "ENGTYPE_1"],
        "tags": ["provinces", "regions", "world", "admin-1", "boundaries", "gadm"],
        "out": "gadm/admin-1.topojson",
        "object_name": "admin1",
    },
    {
        "level": 2,
        "layer": "ADM_2",
        "name": "Districts / Counties (GADM)",
        "description": "Second-level administrative divisions for all countries worldwide.",
        "fields": ["GID_0", "GID_1", "GID_2", "COUNTRY", "NAME_1", "NAME_2", "TYPE_2", "ENGTYPE_2"],
        "tags": ["districts", "counties", "world", "admin-2", "detailed", "boundaries", "gadm"],
        "out": "gadm/admin-2.topojson",
        "object_name": "admin2",
    },
]


class Gadm(DataSource):
    def fetch(self) -> list[DatasetMeta]:
        results = []

        print(f"[gadm] Downloading GeoPackage (all levels)...")
        print(f"  URL: {GADM_URL}")

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            zip_path = tmp_path / "gadm.zip"

            # Stream download — file is large (~700MB compressed)
            r = requests.get(GADM_URL, timeout=600, stream=True)
            r.raise_for_status()
            total = 0
            with open(zip_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 1024):
                    f.write(chunk)
                    total += len(chunk)
            print(f"  Downloaded {total // (1024*1024)}MB")

            print(f"  Extracting...")
            zipfile.ZipFile(zip_path).extractall(tmp_path)

            gpkg_candidates = list(tmp_path.glob("**/*.gpkg"))
            if not gpkg_candidates:
                raise ValueError("No .gpkg file found in GADM zip")
            gpkg_path = gpkg_candidates[0]
            print(f"  GeoPackage: {gpkg_path.name}")

            for d in LEVELS:
                out_path = self.output_dir / d["out"]
                print(f"[gadm] Processing level {d['level']} ({d['layer']})...")
                try:
                    gdf = gpd.read_file(gpkg_path, layer=d["layer"])
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
                    print(f"  {count} features written")
                except Exception as e:
                    print(f"  ERROR on level {d['level']}: {e}")

        return results
