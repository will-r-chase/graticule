import io
import json
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path

import geopandas as gpd
import requests


# ---------------------------------------------------------------------------
# Downloading
# ---------------------------------------------------------------------------

def download(url: str, desc: str = "") -> bytes:
    label = desc or url
    print(f"    → Downloading {label}...", flush=True)
    t0 = time.time()
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    elapsed = time.time() - t0
    kb = len(r.content) // 1024
    print(f"      {kb:,}KB in {elapsed:.1f}s", flush=True)
    return r.content


def read_geodataframe(url: str = None, content: bytes = None, suffix: str = ".zip") -> gpd.GeoDataFrame:
    """Read a GeoDataFrame from a URL or raw bytes. Handles zip files transparently."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        if url and not content:
            content = download(url)
        file_path = tmp_path / f"data{suffix}"
        file_path.write_bytes(content)
        if suffix == ".zip":
            zipfile.ZipFile(file_path).extractall(tmp_path)
            candidates = (
                list(tmp_path.glob("**/*.shp"))
                + list(tmp_path.glob("**/*.geojson"))
                + list(tmp_path.glob("**/*.gpkg"))
            )
            if not candidates:
                raise ValueError("No readable spatial file found in zip")
            file_path = candidates[0]
            print(f"      Extracted: {file_path.name}", flush=True)
        return gpd.read_file(file_path)


# ---------------------------------------------------------------------------
# Geometry normalisation
# ---------------------------------------------------------------------------

def normalize(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Reproject to WGS84, drop invalid/empty geometries, fix topology."""
    before = len(gdf)
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs("EPSG:4326")
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].copy()
    gdf.geometry = gdf.geometry.make_valid()
    after = len(gdf)
    if before != after:
        print(f"      Dropped {before - after} invalid/empty geometries", flush=True)
    return gdf


def keep_fields(gdf: gpd.GeoDataFrame, fields: list[str]) -> gpd.GeoDataFrame:
    """Keep only the requested fields (plus geometry), ignoring missing ones."""
    present = [f for f in fields if f in gdf.columns]
    missing = [f for f in fields if f not in gdf.columns]
    if missing:
        print(f"      Note: fields not found (skipped): {missing}", flush=True)
    return gdf[present + ["geometry"]].copy()


# ---------------------------------------------------------------------------
# TopoJSON conversion via mapshaper CLI
# ---------------------------------------------------------------------------

def write_topojson(gdf: gpd.GeoDataFrame, path: Path, object_name: str = "data") -> int:
    """
    Convert GeoDataFrame to TopoJSON using mapshaper CLI.
    Mapshaper is orders of magnitude faster than the Python topojson library
    for large/complex datasets (seconds vs. many minutes).
    Returns feature count.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    count = len(gdf)
    print(f"      Converting {count:,} features → TopoJSON via mapshaper...", flush=True)
    t0 = time.time()

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        geojson_path = tmp_path / "input.geojson"
        gdf.to_file(geojson_path, driver="GeoJSON")

        result = subprocess.run(
            [
                "mapshaper",
                str(geojson_path),
                "-rename-layers", object_name,
                "-o", str(path),
                "format=topojson",
                "quantization=1000000",
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )

    elapsed = time.time() - t0
    if result.returncode != 0:
        raise RuntimeError(f"mapshaper failed:\n{result.stderr.strip()}")

    size_kb = path.stat().st_size // 1024
    print(f"      Done: {size_kb:,}KB in {elapsed:.1f}s", flush=True)
    return count


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def bbox_of(gdf: gpd.GeoDataFrame) -> list[float]:
    b = gdf.total_bounds  # [minx, miny, maxx, maxy]
    return [round(float(v), 4) for v in b]
