import json
import os
from datetime import datetime, timezone
from pathlib import Path

from .sources.base import DatasetMeta

# Committed metadata for one-off sources (WDPA, GeoNames, HydroRIVERS) that are
# NOT re-processed on every pipeline run. Their `*_once` runners write a manifest
# here; `build()` merges them so the regular run's catalog.json includes them
# without wiping them. See run_*_once.py.
MANIFESTS_DIR = Path(__file__).parent / "manifests"


def build(datasets: list[DatasetMeta], output_dir: Path):
    base_url = os.environ.get("R2_PUBLIC_URL", "").rstrip("/")

    entries = [_serialize(d) for d in datasets]
    # Append one-off datasets from committed manifests (id collisions: the live
    # run wins, so a source promoted out of one-off status just works).
    seen = {e["id"] for e in entries}
    manifest_entries = [e for e in load_manifests() if e["id"] not in seen]
    entries.extend(manifest_entries)

    catalog = {
        "version": "1.0",
        "generated": datetime.now(timezone.utc).isoformat(),
        "baseUrl": base_url,
        "datasets": entries,
    }

    path = output_dir / "catalog.json"
    with open(path, "w") as f:
        json.dump(catalog, f, indent=2)
    print(f"Catalog written: {len(entries)} datasets "
          f"({len(datasets)} live + {len(manifest_entries)} from manifests) → {path}")


def write_manifest(name: str, datasets: list[DatasetMeta]) -> Path:
    """Persist a one-off source's dataset metadata to pipeline/manifests/<name>.json
    (committed to the repo). Called by the `*_once` runners after processing."""
    MANIFESTS_DIR.mkdir(parents=True, exist_ok=True)
    path = MANIFESTS_DIR / f"{name}.json"
    with open(path, "w") as f:
        json.dump([_serialize(d) for d in datasets], f, indent=2)
    print(f"Manifest written: {len(datasets)} datasets → {path}")
    return path


def load_manifests() -> list[dict]:
    """Read every committed one-off manifest as already-serialized catalog entries."""
    if not MANIFESTS_DIR.exists():
        return []
    entries = []
    for p in sorted(MANIFESTS_DIR.glob("*.json")):
        with open(p) as f:
            entries.extend(json.load(f))
    return entries


def _serialize(d: DatasetMeta) -> dict:
    entry = {
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
    if d.coverage:
        entry["coverage"] = d.coverage
    if d.geometry_type:
        entry["geometryType"] = d.geometry_type
    if d.layers:
        entry["layers"] = [
            {
                "name": l.name,
                "objectName": l.object_name,
                "filePath": l.file_path,
                **({"geometryType": l.geometry_type} if l.geometry_type else {}),
            }
            for l in d.layers
        ]
    return entry
