import json
import os
from datetime import datetime, timezone
from pathlib import Path

from .sources.base import DatasetMeta


def build(datasets: list[DatasetMeta], output_dir: Path):
    base_url = os.environ.get("R2_PUBLIC_URL", "").rstrip("/")

    catalog = {
        "version": "1.0",
        "generated": datetime.now(timezone.utc).isoformat(),
        "baseUrl": base_url,
        "datasets": [_serialize(d) for d in datasets],
    }

    path = output_dir / "catalog.json"
    with open(path, "w") as f:
        json.dump(catalog, f, indent=2)
    print(f"Catalog written: {len(datasets)} datasets → {path}")


def _serialize(d: DatasetMeta) -> dict:
    return {
        "id": d.id,
        "name": d.name,
        "description": d.description,
        "source": d.source,
        "sourceName": d.source_name,
        "adminLevel": d.admin_level,
        "region": d.region,
        "license": d.license,
        "tags": d.tags,
        "filePath": d.file_path,
        "featureCount": d.feature_count,
        "bbox": d.bbox,
    }
