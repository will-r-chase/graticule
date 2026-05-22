import json
from pathlib import Path

import geopandas as gpd

from ..process import normalize, write_topojson, bbox_of
from .base import DataSource, DatasetMeta

CUSTOM_DIR = Path(__file__).parent.parent / "custom"

SPATIAL_SUFFIXES = {".geojson", ".json", ".shp", ".gpkg", ".kml", ".topojson"}


class Custom(DataSource):
    def fetch(self) -> list[DatasetMeta]:
        results = []

        for meta_path in sorted(CUSTOM_DIR.glob("*.meta.json")):
            stem = meta_path.stem.replace(".meta", "")
            data_path = self._find_data_file(stem)
            if not data_path:
                print(f"[custom] WARNING: no data file found for {meta_path.name}, skipping")
                continue

            with open(meta_path) as f:
                meta = json.load(f)

            dataset_id = meta.get("id", f"custom/{stem}")
            out_path = self.output_dir / f"custom/{stem}.topojson"
            print(f"[custom] {meta.get('name', stem)}")
            try:
                gdf = gpd.read_file(data_path)
                gdf = normalize(gdf)
                count = write_topojson(gdf, out_path, object_name=stem)
                results.append(DatasetMeta(
                    id=dataset_id,
                    name=meta.get("name", stem),
                    description=meta.get("description", ""),
                    source="custom",
                    source_name="Custom",
                    admin_level=meta.get("admin_level", 0),
                    region=meta.get("region", "world"),
                    license=meta.get("license", "owned"),
                    tags=meta.get("tags", []),
                    file_path=str(out_path.relative_to(self.output_dir)),
                    feature_count=count,
                    bbox=meta.get("bbox") or bbox_of(gdf),
                ))
            except Exception as e:
                print(f"  ERROR: {e}")

        return results

    def _find_data_file(self, stem: str) -> Path | None:
        for suffix in SPATIAL_SUFFIXES:
            candidate = CUSTOM_DIR / f"{stem}{suffix}"
            if candidate.exists():
                return candidate
        return None
