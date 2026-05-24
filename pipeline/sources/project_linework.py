"""
Project Linework — https://github.com/mapsam/project-linework
13 hand-crafted, stylized world basemap datasets. License: CC0 (public domain).

Each dataset contains multiple layers (land, admin0 polygons, admin0 lines,
admin1 polygons, rivers, etc.) which vary by dataset. We download all GeoJSON
layers per dataset and write them as separate TopoJSON files, with one catalog
entry per dataset listing its available layers.
"""

import re
import tempfile
from pathlib import Path
from urllib.parse import unquote

import geopandas as gpd
import requests

from ..process import normalize, write_topojson, bbox_of
from .base import DataSource, DatasetMeta, LayerMeta

REPO = "mapsam/project-linework"
BRANCH = "master"
RAW_BASE = f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/"
API_TREE = f"https://api.github.com/repos/{REPO}/git/trees/{BRANCH}?recursive=1"

# Human-readable names, descriptions, and coverage metadata for each dataset slug.
# `region` must match one of the REGION_FILTERS values in the app config.
# `tags` should include at least one functional tag (e.g. "boundaries") so the
# type filter can match the dataset, plus aesthetic tags for search.
DATASET_INFO = {
    "1981": {
        "name": "1981",
        "description": "Original 1981-style hand-crafted world linework. Clean, simple administrative boundaries with a classic cartographic feel.",
        "coverage": "Worldwide. Coastline | Admin 0 (countries) | Admin 1 (states/provinces) for USA & Canada | Major lakes | Major rivers",
        "region": "World",
        "admin_level": 1,
        "tags": ["boundaries", "countries", "hand-drawn", "classic", "stylized"],
    },
    "1981-v1.1": {
        "name": "1981 v1.1",
        "description": "Updated version of the 1981 dataset with Ukraine added.",
        "coverage": "Worldwide. Coastline | Admin 0 (countries) | Admin 1 (states/provinces) for USA & Canada | Major lakes | Major rivers",
        "region": "World",
        "admin_level": 1,
        "tags": ["boundaries", "countries", "hand-drawn", "classic", "stylized"],
    },
    "angular": {
        "name": "Angular",
        "description": "Traced from a 1980 corporate annual report map. Sharp, angular linework with a retro business aesthetic.",
        "coverage": "Admin 1 (states) & Admin 0 (countries) for the lower 48 US states (DC not included), plus southern portions of Canada",
        "region": "North America",
        "admin_level": 1,
        "tags": ["boundaries", "countries", "states", "hand-drawn", "angular", "retro", "stylized"],
    },
    "charmingly-inaccurate": {
        "name": "Charmingly Inaccurate",
        "description": "Intentionally imprecise world basemap. Charming, organic shapes that prioritize feel over accuracy.",
        "coverage": "Admin 1 (states) for the lower 48 United States | Admin 0 (countries) for United States",
        "region": "USA",
        "admin_level": 1,
        "tags": ["boundaries", "countries", "states", "hand-drawn", "organic", "imprecise", "stylized"],
    },
    "elmer-casual": {
        "name": "Elmer Casual",
        "description": "Casual hand-drawn style with a loose, sketched quality.",
        "coverage": "Admin 0 (countries) for North America (excl. far north islands and Greenland), Europe (excl. Russia and Asian Turkey), and Japan | Admin 1 (states/provinces) for United States, Canada, and Japan",
        "region": "World",
        "admin_level": 1,
        "tags": ["boundaries", "countries", "states", "hand-drawn", "casual", "sketchy", "stylized"],
    },
    "geo-metro": {
        "name": "Geo Metro",
        "description": "Metro and transit-map aesthetic applied to world geography. Simplified shapes with a graphic design sensibility.",
        "coverage": "North America only. Coastline | Admin 0 (countries) | Admin 1 (states/provinces) for US & Canada | Large lakes | Major rivers",
        "region": "North America",
        "admin_level": 1,
        "tags": ["boundaries", "countries", "states", "hand-drawn", "geometric", "metro", "graphic", "stylized"],
    },
    "geomotional": {
        "name": "Geomotional",
        "description": "A geometric and emotional take on world linework.",
        "coverage": "Admin 1 (states) for the lower 48 US states only. DC not included",
        "region": "USA",
        "admin_level": 1,
        "tags": ["boundaries", "states", "hand-drawn", "geometric", "stylized"],
    },
    "liana": {
        "name": "Liana",
        "description": "Organic-style linework by Sarah Bennett. Flowing, natural shapes.",
        "coverage": "North America only. Coastline | Admin 0 (countries) | Admin 1 (states/provinces) for United States | Large lakes",
        "region": "North America",
        "admin_level": 1,
        "tags": ["boundaries", "countries", "states", "hand-drawn", "organic", "flowing", "stylized"],
    },
    "moriarty-hand-large": {
        "name": "Moriarty Hand (Large Scale)",
        "description": "Hand-drawn linework at large scale. Detailed organic boundaries with a personal cartographic touch.",
        "coverage": "Worldwide. Coastline | Admin 0 (countries) | Admin 1 (states/provinces) for USA & Canada | Major lakes | Major rivers",
        "region": "World",
        "admin_level": 1,
        "tags": ["boundaries", "countries", "hand-drawn", "detailed", "organic", "stylized"],
    },
    "moriarty-hand-small": {
        "name": "Moriarty Hand (Small Scale)",
        "description": "Hand-drawn linework at small scale. Simplified organic boundaries for overview maps.",
        "coverage": "Worldwide. Coastline | Admin 0 (countries) | Admin 1 (states/provinces) for USA & Canada | Major lakes | Major rivers",
        "region": "World",
        "admin_level": 1,
        "tags": ["boundaries", "countries", "hand-drawn", "simple", "organic", "stylized"],
    },
    "times-approximate": {
        "name": "Times Approximate",
        "description": "Newspaper-style linework inspired by the aesthetic of traditional printed maps.",
        "coverage": "Admin 1 (states/provinces) for all 50 United States | Admin 0 (countries) for United States, parts of Mexico and Canada",
        "region": "USA",
        "admin_level": 1,
        "tags": ["boundaries", "countries", "states", "hand-drawn", "newspaper", "traditional", "stylized"],
    },
    "twenty-seventy": {
        "name": "Twenty Seventy",
        "description": "Retro 1970s-style world linework with a period-appropriate aesthetic.",
        "coverage": "North America only (excluding some arctic islands). Admin 0 (countries) | Admin 1 (states/provinces) for United States & Canada",
        "region": "North America",
        "admin_level": 1,
        "tags": ["boundaries", "countries", "states", "hand-drawn", "retro", "stylized"],
    },
    "wargames": {
        "name": "Wargames",
        "description": "Hex-grid wargame aesthetic applied to world geography. Features hexagonal land, sea, and admin tiles.",
        "coverage": "Worldwide. Coastline | Admin 0 | Admin 1 for AUS, BRA, CAN, CHN, COD, DEU, ESP, FRA, IND, ITA, MDG, MEX, MLI, RUS, USA, ZAF | Major lakes",
        "region": "World",
        "admin_level": 1,
        "tags": ["boundaries", "countries", "hand-drawn", "hex", "wargame", "geometric", "stylized"],
    },
    "weekend-update": {
        "name": "Weekend Update",
        "description": "Inspired by the SNL Weekend Update map aesthetic. Bold, graphic world linework.",
        "coverage": "Admin 0 (countries) for Europe (excl. Russia, Asian Turkey, and some smaller nations) and continental USA | Admin 1 (states) for continental USA",
        "region": "World",
        "admin_level": 1,
        "tags": ["boundaries", "countries", "states", "hand-drawn", "bold", "graphic", "stylized"],
    },
}

# Normalize layer filenames to clean display names and object keys
def _layer_display_name(filename: str) -> str:
    stem = Path(filename).stem
    # Normalize common naming variants
    name = stem.lower()
    name = re.sub(r"[_\-]+", " ", name)
    # Title case, fix known patterns
    replacements = {
        "admin0 poly": "Admin 0 Polygons",
        "admin 0 polygons": "Admin 0 Polygons",
        "admin0 lines": "Admin 0 Lines",
        "admin 0 lines": "Admin 0 Lines",
        "admin1 poly": "Admin 1 Polygons",
        "admin 1 polygons": "Admin 1 Polygons",
        "admin1 lines": "Admin 1 Lines",
        "admin 1 lines": "Admin 1 Lines",
        "waterbodies": "Waterbodies",
        "rivers": "Rivers",
        "streams": "Streams",
        "lakes": "Lakes",
        "land": "Land",
        "coast": "Coastline",
        "sea": "Sea",
        "landhexes": "Land Hexes",
        "seahexes": "Sea Hexes",
        "lakehexes": "Lake Hexes",
        "lines": "Lines",
        "polygons": "Polygons",
    }
    return replacements.get(name, stem.replace("_", " ").replace("-", " ").title())


def _object_name(filename: str) -> str:
    stem = Path(filename).stem
    return re.sub(r"[^a-z0-9]", "_", stem.lower()).strip("_")


def _get_tree() -> list[dict]:
    r = requests.get(API_TREE, timeout=30)
    r.raise_for_status()
    return r.json()["tree"]


def _group_geojson_files(tree: list[dict]) -> dict[str, list[str]]:
    """
    Group GeoJSON file paths by dataset slug.
    Returns {dataset_slug: [relative_path_in_repo, ...]}
    """
    groups: dict[str, list[str]] = {}

    for item in tree:
        if item["type"] != "blob":
            continue
        path = item["path"]
        parts = path.split("/")

        # Must be under LINEWORK/
        if len(parts) < 2 or parts[0] != "LINEWORK":
            continue

        dataset = parts[1]

        # moriarty-hand has Large Scale / Small Scale subdirs
        if dataset == "moriarty-hand":
            if len(parts) < 4:
                continue
            scale = parts[2].lower().replace(" ", "-")  # "large-scale" or "small-scale"
            format_dir = parts[3]
            slug = f"moriarty-hand-{scale.split('-')[0]}"  # "moriarty-hand-large" / "moriarty-hand-small"
        else:
            if len(parts) < 4:
                continue
            format_dir = parts[2]
            slug = dataset

        if format_dir != "geojson":
            continue

        # Only include actual spatial files
        ext = Path(path).suffix.lower()
        if ext not in {".geojson", ".json"}:
            continue

        groups.setdefault(slug, []).append(path)

    return groups


class ProjectLinework(DataSource):
    def fetch(self) -> list[DatasetMeta]:
        print("[project-linework] Fetching GitHub tree...")
        tree = _get_tree()
        groups = _group_geojson_files(tree)
        results = []

        for slug, geojson_paths in sorted(groups.items()):
            info = DATASET_INFO.get(slug)
            if not info:
                print(f"  WARNING: unknown dataset slug '{slug}', skipping")
                continue

            print(f"[project-linework] {info['name']} ({len(geojson_paths)} layers)")
            layers: list[LayerMeta] = []
            total_bbox = None

            for repo_path in sorted(geojson_paths):
                filename = Path(repo_path).name
                object_name = _object_name(filename)
                out_path = self.output_dir / f"project-linework/{slug}/{object_name}.topojson"

                try:
                    url = RAW_BASE + repo_path.replace(" ", "%20")
                    r = requests.get(url, timeout=60)
                    r.raise_for_status()

                    with tempfile.TemporaryDirectory() as tmp:
                        p = Path(tmp) / filename
                        p.write_bytes(r.content)
                        try:
                            gdf = gpd.read_file(p)
                        except Exception:
                            # Some files use latin-1 encoding instead of UTF-8
                            gdf = gpd.read_file(p, encoding="latin-1")

                    gdf = normalize(gdf)
                    write_topojson(gdf, out_path, object_name=object_name)

                    layer_bbox = bbox_of(gdf)
                    if total_bbox is None:
                        total_bbox = layer_bbox
                    else:
                        total_bbox = [
                            min(total_bbox[0], layer_bbox[0]),
                            min(total_bbox[1], layer_bbox[1]),
                            max(total_bbox[2], layer_bbox[2]),
                            max(total_bbox[3], layer_bbox[3]),
                        ]

                    layer_geom_types = sorted(gdf.geom_type.dropna().unique().tolist())

                    layers.append(LayerMeta(
                        name=_layer_display_name(filename),
                        object_name=object_name,
                        file_path=str(out_path.relative_to(self.output_dir)),
                        geometry_type=", ".join(layer_geom_types),
                    ))
                    print(f"    + {_layer_display_name(filename)}")

                except Exception as e:
                    print(f"    ERROR on {filename}: {e}")

            if not layers:
                continue

            # Aggregate unique geometry types across all sub-layers.
            all_geom_types = sorted({
                t
                for layer in layers
                for t in layer.geometry_type.split(", ")
                if t
            })

            results.append(DatasetMeta(
                id=f"project-linework/{slug}",
                name=info["name"],
                description=info["description"],
                source="project-linework",
                source_name="Project Linework",
                admin_level=info["admin_level"],
                region=info["region"],
                license="cc0",
                tags=info["tags"],
                file_path=f"project-linework/{slug}",
                feature_count=0,
                bbox=total_bbox or [-180, -90, 180, 90],
                layers=layers,
                coverage=info["coverage"],
                geometry_type=", ".join(all_geom_types),
            ))

        return results
