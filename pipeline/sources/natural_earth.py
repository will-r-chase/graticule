import time
from pathlib import Path

from ..process import normalize, keep_fields, write_topojson, bbox_of, read_geodataframe
from .base import DataSource, DatasetMeta

CDN = "https://naciscdn.org/naturalearth"

DATASETS = [
    {
        "scale": "10m",
        "layer": "admin_0_countries",
        "admin_level": 0,
        "fields": ["NAME", "ISO_A2", "ISO_A3", "CONTINENT", "REGION_UN", "SUBREGION", "POP_EST"],
        "name": "Countries (10m — detailed)",
        "description": "World country boundaries at 1:10m scale. Most detailed Natural Earth country dataset.",
        "tags": ["countries", "world", "detailed", "boundaries"],
    },
    {
        "scale": "50m",
        "layer": "admin_0_countries",
        "admin_level": 0,
        "fields": ["NAME", "ISO_A2", "ISO_A3", "CONTINENT", "REGION_UN", "SUBREGION", "POP_EST"],
        "name": "Countries (50m — medium)",
        "description": "World country boundaries at 1:50m scale. Good for most world and continental maps.",
        "tags": ["countries", "world", "medium", "boundaries"],
    },
    {
        "scale": "110m",
        "layer": "admin_0_countries",
        "admin_level": 0,
        "fields": ["NAME", "ISO_A2", "ISO_A3", "CONTINENT", "REGION_UN", "SUBREGION", "POP_EST"],
        "name": "Countries (110m — coarse)",
        "description": "World country boundaries at 1:110m scale. Best for small world overview maps.",
        "tags": ["countries", "world", "coarse", "boundaries"],
    },
    {
        "scale": "10m",
        "layer": "admin_1_states_provinces",
        "admin_level": 1,
        "fields": ["NAME", "iso_3166_2", "admin", "type", "REGION", "ISO_A2"],
        "name": "States & Provinces (10m — detailed)",
        "description": "First-level administrative divisions worldwide at 1:10m scale.",
        "tags": ["states", "provinces", "world", "detailed", "admin-1"],
    },
    {
        "scale": "50m",
        "layer": "admin_1_states_provinces",
        "admin_level": 1,
        "fields": ["NAME", "iso_3166_2", "admin", "type", "REGION", "ISO_A2"],
        "name": "States & Provinces (50m — medium)",
        "description": "First-level administrative divisions worldwide at 1:50m scale.",
        "tags": ["states", "provinces", "world", "medium", "admin-1"],
    },
]


class NaturalEarth(DataSource):
    def fetch(self) -> list[DatasetMeta]:
        results = []
        total = len(DATASETS)

        for i, d in enumerate(DATASETS, 1):
            scale = d["scale"]
            layer = d["layer"]
            dataset_id = f"natural-earth/{layer.replace('_', '-')}/ne_{scale}"
            out_path = self.output_dir / f"natural-earth/{layer.replace('_', '-')}/ne_{scale}.topojson"
            url = f"{CDN}/{scale}/cultural/ne_{scale}_{layer}.zip"

            print(f"\n  [{i}/{total}] {d['name']}", flush=True)
            t0 = time.time()
            try:
                gdf = read_geodataframe(url=url)
                print(f"      Read {len(gdf):,} features", flush=True)
                gdf = normalize(gdf)
                gdf = keep_fields(gdf, d["fields"])
                count = write_topojson(gdf, out_path, object_name=layer)
                elapsed = time.time() - t0
                print(f"      ✓ Complete in {elapsed:.1f}s", flush=True)

                results.append(DatasetMeta(
                    id=dataset_id,
                    name=d["name"],
                    description=d["description"],
                    source="natural-earth",
                    source_name="Natural Earth",
                    admin_level=d["admin_level"],
                    region="world",
                    license="public-domain",
                    tags=d["tags"],
                    file_path=str(out_path.relative_to(self.output_dir)),
                    feature_count=count,
                    bbox=bbox_of(gdf),
                ))
            except Exception as e:
                elapsed = time.time() - t0
                print(f"      ✗ ERROR after {elapsed:.1f}s: {e}", flush=True)

        return results
