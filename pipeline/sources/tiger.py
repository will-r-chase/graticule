import time
from pathlib import Path

from ..process import normalize, keep_fields, write_topojson, bbox_of, read_geodataframe
from .base import DataSource, DatasetMeta

YEAR = "2023"
BASE = f"https://www2.census.gov/geo/tiger/TIGER{YEAR}"

DATASETS = [
    {
        "id": "tiger/states",
        "name": "US States",
        "description": "US state boundaries from the Census Bureau TIGER/Line files.",
        "url": f"{BASE}/STATE/tl_{YEAR}_us_state.zip",
        "admin_level": 1,
        "fields": ["NAME", "STUSPS", "STATEFP", "GEOID", "ALAND"],
        "tags": ["states", "usa", "admin-1", "boundaries"],
        "out": "tiger/states.topojson",
        "object_name": "states",
    },
    {
        "id": "tiger/counties",
        "name": "US Counties",
        "description": "US county boundaries from the Census Bureau TIGER/Line files.",
        "url": f"{BASE}/COUNTY/tl_{YEAR}_us_county.zip",
        "admin_level": 2,
        "fields": ["NAME", "NAMELSAD", "STATEFP", "COUNTYFP", "GEOID", "ALAND"],
        "tags": ["counties", "usa", "admin-2", "detailed", "boundaries"],
        "out": "tiger/counties.topojson",
        "object_name": "counties",
    },
]


class Tiger(DataSource):
    def fetch(self) -> list[DatasetMeta]:
        results = []
        total = len(DATASETS)

        for i, d in enumerate(DATASETS, 1):
            out_path = self.output_dir / d["out"]
            print(f"\n  [{i}/{total}] {d['name']}", flush=True)
            t0 = time.time()
            try:
                gdf = read_geodataframe(url=d["url"])
                print(f"      Read {len(gdf):,} features", flush=True)
                gdf = normalize(gdf)
                gdf = keep_fields(gdf, d["fields"])
                count = write_topojson(gdf, out_path, object_name=d["object_name"])
                elapsed = time.time() - t0
                print(f"      ✓ Complete in {elapsed:.1f}s", flush=True)

                results.append(DatasetMeta(
                    id=d["id"],
                    name=d["name"],
                    description=d["description"],
                    source="tiger",
                    source_name="US Census TIGER",
                    admin_level=d["admin_level"],
                    region="usa",
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
