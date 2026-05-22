import io
import json
import tempfile
import zipfile
from pathlib import Path

import geopandas as gpd
import requests
import topojson as tp


def download(url: str, desc: str = "") -> bytes:
    print(f"  Downloading {desc or url}...")
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    return r.content


def download_zip(url: str, desc: str = "") -> dict[str, bytes]:
    """Download a zip and return {filename: bytes} for all files inside."""
    content = download(url, desc)
    zf = zipfile.ZipFile(io.BytesIO(content))
    return {name: zf.read(name) for name in zf.namelist()}


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
            candidates = list(tmp_path.glob("**/*.shp")) + list(tmp_path.glob("**/*.geojson")) + list(tmp_path.glob("**/*.gpkg"))
            if not candidates:
                raise ValueError(f"No readable spatial file found in zip")
            file_path = candidates[0]
        return gpd.read_file(file_path)


def normalize(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Reproject to WGS84 and drop invalid/empty geometries."""
    if gdf.crs is None:
        gdf = gdf.set_crs("EPSG:4326")
    elif gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs("EPSG:4326")
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].copy()
    gdf.geometry = gdf.geometry.make_valid()
    return gdf


def keep_fields(gdf: gpd.GeoDataFrame, fields: list[str]) -> gpd.GeoDataFrame:
    """Keep only the requested fields (plus geometry), ignoring missing ones."""
    present = [f for f in fields if f in gdf.columns]
    return gdf[present + ["geometry"]].copy()


def write_topojson(gdf: gpd.GeoDataFrame, path: Path, object_name: str = "data") -> int:
    """Convert GeoDataFrame to TopoJSON and write to path. Returns feature count."""
    path.parent.mkdir(parents=True, exist_ok=True)
    topo = tp.Topology(gdf, prequantize=1e6, object_name=object_name)
    with open(path, "w") as f:
        json.dump(topo.to_dict(), f, separators=(",", ":"))
    return len(gdf)


def bbox_of(gdf: gpd.GeoDataFrame) -> list[float]:
    b = gdf.total_bounds  # [minx, miny, maxx, maxy]
    return [round(float(v), 4) for v in b]
