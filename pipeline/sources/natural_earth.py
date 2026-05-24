"""
Natural Earth vector datasets — https://www.naturalearthdata.com
License: Public domain

Datasets are organised by category (cultural / physical) and scale
(10m / 50m / 110m). Not every dataset exists at every scale; missing
combinations raise HTTP 404s which are caught and skipped gracefully.
"""

import time
from pathlib import Path

from ..process import normalize, keep_fields, write_topojson, bbox_of, read_geodataframe
from .base import DataSource, DatasetMeta

CDN = "https://naciscdn.org/naturalearth"

# ---------------------------------------------------------------------------
# Dataset definitions
#
# Each entry: (layer, category, scales, admin_level, fields, name, description, tags)
#
# scales: list of scale strings to attempt — 404s are caught and skipped.
# fields: list of property fields to retain, or None to keep all.
# ---------------------------------------------------------------------------

ALL_SCALES = ["10m", "50m", "110m"]
LARGE_SCALES = ["10m", "50m"]

DATASETS = [
    # -------------------------------------------------------------------------
    # Cultural — admin-0
    # -------------------------------------------------------------------------
    dict(
        layer="admin_0_countries",
        category="cultural",
        scales=ALL_SCALES,
        admin_level=0,
        fields=["NAME", "ISO_A2", "ISO_A3", "CONTINENT", "REGION_UN", "SUBREGION", "POP_EST"],
        name="Countries",
        description="World country boundaries.",
        tags=["countries", "world", "admin-0", "boundaries"],
    ),
    dict(
        layer="admin_0_sovereignty",
        category="cultural",
        scales=ALL_SCALES,
        admin_level=0,
        fields=["NAME", "ISO_A2", "ISO_A3", "TYPE", "ADMIN"],
        name="Sovereignty",
        description="World sovereignty boundaries, distinguishing sovereigns from dependencies.",
        tags=["sovereignty", "world", "admin-0", "boundaries"],
    ),
    dict(
        layer="admin_0_map_units",
        category="cultural",
        scales=ALL_SCALES,
        admin_level=0,
        fields=["NAME", "ISO_A2", "ISO_A3", "TYPE", "ADMIN"],
        name="Map Units",
        description="Country-level map units — useful when territories should be shown separately.",
        tags=["map-units", "world", "admin-0", "boundaries"],
    ),
    dict(
        layer="admin_0_boundary_lines_land",
        category="cultural",
        scales=ALL_SCALES,
        admin_level=0,
        fields=["featurecla", "scalerank"],
        name="Land Boundaries",
        description="International land boundaries as lines.",
        tags=["boundaries", "lines", "world", "admin-0"],
    ),
    dict(
        layer="admin_0_boundary_lines_disputed_areas",
        category="cultural",
        scales=["10m"],
        admin_level=0,
        fields=["featurecla", "scalerank", "labelrank", "NAME"],
        name="Disputed Boundaries",
        description="Disputed and de-facto international boundary lines.",
        tags=["disputed", "boundaries", "lines", "world"],
    ),

    # -------------------------------------------------------------------------
    # Cultural — admin-1
    # -------------------------------------------------------------------------
    dict(
        layer="admin_1_states_provinces",
        category="cultural",
        scales=ALL_SCALES,
        admin_level=1,
        fields=["name", "name_en", "iso_3166_2", "iso_a2", "admin", "adm0_a3", "type", "type_en", "region", "code_hasc"],
        name="States & Provinces",
        description="First-level administrative divisions worldwide.",
        tags=["states", "provinces", "world", "admin-1", "boundaries"],
    ),
    dict(
        layer="admin_1_states_provinces_lines",
        category="cultural",
        scales=ALL_SCALES,
        admin_level=1,
        fields=["adm0_a3", "scalerank", "featurecla"],
        name="State & Province Boundaries",
        description="First-level administrative division boundaries as lines.",
        tags=["states", "provinces", "world", "admin-1", "lines"],
    ),

    # -------------------------------------------------------------------------
    # Cultural — admin-2
    # -------------------------------------------------------------------------
    dict(
        layer="admin_2_counties",
        category="cultural",
        scales=["10m"],
        admin_level=2,
        fields=["name", "code_local", "code_hasc", "type_en", "provnum_ne", "adm0_a3"],
        name="Counties",
        description="US county boundaries at 10m scale.",
        region="USA",
        tags=["counties", "districts", "USA", "admin-2", "detailed", "boundaries"],
    ),

    # -------------------------------------------------------------------------
    # Cultural — populated places
    # -------------------------------------------------------------------------
    dict(
        layer="populated_places",
        category="cultural",
        scales=ALL_SCALES,
        admin_level=0,
        fields=["name", "namealt", "adm0name", "adm1name", "ISO_A2", "featurecla", "scalerank", "POP_MIN", "POP_MAX", "latitude", "longitude"],
        name="Populated Places",
        description="Cities, towns, and villages. Point dataset.",
        tags=["cities", "towns", "places", "points", "world"],
    ),

    # -------------------------------------------------------------------------
    # Cultural — infrastructure
    # -------------------------------------------------------------------------
    dict(
        layer="urban_areas",
        category="cultural",
        scales=LARGE_SCALES,
        admin_level=0,
        fields=["name_conve", "name_en", "scalerank", "area_sqkm"],
        name="Urban Areas",
        description="Urban built-up areas.",
        tags=["urban", "cities", "areas", "world"],
    ),
    dict(
        layer="roads",
        category="cultural",
        scales=LARGE_SCALES,
        admin_level=0,
        fields=["type", "name", "label", "scalerank"],
        name="Roads",
        description="Major roads and highways.",
        tags=["roads", "transport", "lines", "world"],
    ),
    dict(
        layer="railroads",
        category="cultural",
        scales=["10m"],
        admin_level=0,
        fields=["type", "name", "scalerank"],
        name="Railroads",
        description="Major railroad lines.",
        tags=["railroads", "transport", "lines", "world"],
    ),
    dict(
        layer="airports",
        category="cultural",
        scales=LARGE_SCALES,
        admin_level=0,
        fields=["name", "iata_code", "icao_code", "featurecla", "scalerank"],
        name="Airports",
        description="Major airports. Point dataset.",
        tags=["airports", "transport", "points", "world"],
    ),
    dict(
        layer="ports",
        category="cultural",
        scales=["10m"],
        admin_level=0,
        fields=["name", "featurecla", "scalerank"],
        name="Ports",
        description="Major ports. Point dataset.",
        tags=["ports", "transport", "points", "world"],
    ),
    dict(
        layer="time_zones",
        category="cultural",
        scales=["10m"],
        admin_level=0,
        fields=["Name", "Zone", "UTC_FORMAT", "ScaleRank"],
        name="Time Zones",
        description="World time zone polygons.",
        tags=["time-zones", "world"],
    ),

    # -------------------------------------------------------------------------
    # Physical — land / ocean / coast
    # -------------------------------------------------------------------------
    dict(
        layer="land",
        category="physical",
        scales=ALL_SCALES,
        admin_level=0,
        fields=["featurecla", "scalerank"],
        name="Land",
        description="Land polygons including major islands.",
        tags=["land", "physical", "world"],
    ),
    dict(
        layer="ocean",
        category="physical",
        scales=ALL_SCALES,
        admin_level=0,
        fields=["featurecla", "scalerank"],
        name="Ocean",
        description="Ocean polygons.",
        tags=["ocean", "physical", "world"],
    ),
    dict(
        layer="coastline",
        category="physical",
        scales=ALL_SCALES,
        admin_level=0,
        fields=["featurecla", "scalerank"],
        name="Coastline",
        description="Coastlines as lines.",
        tags=["coastline", "physical", "lines", "world"],
    ),
    dict(
        layer="minor_islands",
        category="physical",
        scales=["10m"],
        admin_level=0,
        fields=["featurecla", "scalerank"],
        name="Minor Islands",
        description="Minor islands not included in the main land polygon.",
        tags=["islands", "physical", "world"],
    ),

    # -------------------------------------------------------------------------
    # Physical — water
    # -------------------------------------------------------------------------
    dict(
        layer="rivers_lake_centerlines",
        category="physical",
        scales=ALL_SCALES,
        admin_level=0,
        fields=["name", "name_en", "featurecla", "scalerank", "strokeweig"],
        name="Rivers & Lake Centerlines",
        description="Rivers and lake centerlines.",
        tags=["rivers", "water", "physical", "lines", "world"],
    ),
    dict(
        layer="lakes",
        category="physical",
        scales=ALL_SCALES,
        admin_level=0,
        fields=["name", "name_en", "featurecla", "scalerank"],
        name="Lakes",
        description="Natural and artificial lakes.",
        tags=["lakes", "water", "physical", "world"],
    ),
    dict(
        layer="lakes_historic",
        category="physical",
        scales=["10m"],
        admin_level=0,
        fields=["name", "featurecla"],
        name="Historic Lakes",
        description="Lakes that have dried up or dramatically changed historically.",
        tags=["lakes", "historic", "physical", "world"],
    ),
    dict(
        layer="reefs",
        category="physical",
        scales=["10m"],
        admin_level=0,
        fields=["featurecla", "scalerank"],
        name="Reefs",
        description="Coral reefs and rocks.",
        tags=["reefs", "ocean", "physical", "world"],
    ),

    # -------------------------------------------------------------------------
    # Physical — ice / terrain
    # -------------------------------------------------------------------------
    dict(
        layer="glaciated_areas",
        category="physical",
        scales=ALL_SCALES,
        admin_level=0,
        fields=["featurecla", "scalerank"],
        name="Glaciated Areas",
        description="Glaciated areas and ice sheets.",
        tags=["glaciers", "ice", "physical", "world"],
    ),
    dict(
        layer="antarctic_ice_shelves_polys",
        category="physical",
        scales=["10m"],
        admin_level=0,
        fields=["featurecla", "scalerank"],
        name="Antarctic Ice Shelves",
        description="Antarctic ice shelf polygons.",
        tags=["antarctica", "ice", "physical", "world"],
    ),

    # -------------------------------------------------------------------------
    # Physical — reference
    # -------------------------------------------------------------------------
    dict(
        layer="geographic_lines",
        category="physical",
        scales=["10m"],
        admin_level=0,
        fields=["featurecla", "name", "name_long"],
        name="Geographic Lines",
        description="Tropics, polar circles, equator, and other geographic reference lines.",
        tags=["reference", "lines", "geographic", "world"],
    ),
]


class NaturalEarth(DataSource):
    def fetch(self) -> list[DatasetMeta]:
        results = []
        total_attempts = sum(len(d["scales"]) for d in DATASETS)
        attempt = 0

        for d in DATASETS:
            for scale in d["scales"]:
                attempt += 1
                layer = d["layer"]
                category = d["category"]
                dataset_id = f"natural-earth/{layer.replace('_', '-')}/ne_{scale}"
                out_path = self.output_dir / f"natural-earth/{layer.replace('_', '-')}/ne_{scale}.topojson"
                url = f"{CDN}/{scale}/{category}/ne_{scale}_{layer}.zip"

                print(f"\n  [{attempt}/{total_attempts}] {d['name']} ({scale})", flush=True)
                t0 = time.time()
                try:
                    gdf = read_geodataframe(url=url)
                    print(f"      Read {len(gdf):,} features", flush=True)
                    gdf = normalize(gdf)
                    if d["fields"] is not None:
                        gdf = keep_fields(gdf, d["fields"])
                    count = write_topojson(gdf, out_path, object_name=layer)
                    elapsed = time.time() - t0
                    print(f"      ✓ Complete in {elapsed:.1f}s", flush=True)

                    geom_types = ", ".join(sorted(gdf.geom_type.dropna().unique().tolist()))

                    results.append(DatasetMeta(
                        id=dataset_id,
                        name=f"{d['name']} ({scale})",
                        description=d["description"],
                        source="natural-earth",
                        source_name="Natural Earth",
                        admin_level=d["admin_level"],
                        region=d.get("region", "world"),
                        license="public-domain",
                        tags=d["tags"] + [scale],
                        file_path=str(out_path.relative_to(self.output_dir)),
                        feature_count=count,
                        bbox=bbox_of(gdf),
                        geometry_type=geom_types,
                    ))
                except Exception as e:
                    elapsed = time.time() - t0
                    print(f"      ✗ Skipped after {elapsed:.1f}s: {e}", flush=True)

        return results
