"""
GeoNames — https://www.geonames.org
License: CC-BY 4.0 (attribution required).

Distributed as a single ~13.5M row tab-delimited dump (allCountries.txt,
~1.7GB) covering every feature GeoNames tracks worldwide: populated places,
hydrographic features, terrain, parks/areas, and administrative names. Only
a subset of feature codes are label-worthy for the map, and even within
that subset a few buckets (populated places with no reported population;
low-level admin divisions) are large enough on their own to need further
splitting to stay under a reasonable per-file size.

Processed as a one-off (see run_geonames_once.py), not part of the regular
pipeline run.
"""

import time
from pathlib import Path

from .base import DataSource, DatasetMeta, LayerMeta

# Column order in allCountries.txt (tab-delimited, no header).
GEONAMES_COLUMNS = [
    "geonameid", "name", "asciiname", "alternatenames",
    "latitude", "longitude", "feature_class", "feature_code",
    "country_code", "cc2", "admin1_code", "admin2_code",
    "admin3_code", "admin4_code", "population", "elevation",
    "dem", "timezone", "modification_date",
]

# --- Populated places (feature_class == "P") ---------------------------

POPULATION_TIERS = [
    ("major_cities", 1_000_000),
    ("cities", 100_000),
    ("towns", 10_000),
    ("small_towns", 1_000),
]
# below the lowest threshold above -> "villages", which is further split
# by country/continent (see VILLAGE_SPLITS) since it's too large on its own.

VILLAGE_SPLITS = ["CN", "IN"]  # split into their own file; everything else groups by continent

# --- Hydro (feature_class == "H") ---------------------------------------

HYDRO_CATEGORIES = {
    "rivers_streams": {"STM", "STMI"},
    "lakes": {"LK"},
    "bays": {"BAY"},
    "coves_inlets": {"COVE", "INLT"},
    "canals": {"CNL"},
    "wells_ponds_reservoirs_springs": {"WLL", "PND", "RSV", "SPNG"},
    "marsh_swamp": {"MRSH", "SWMP"},
    # everything else in H falls into "other_water"
}

# --- Terrain (feature_class == "T") --------------------------------------

TERRAIN_CATEGORIES = {
    "hills": {"HLL", "HLLS"},
    "mountains": {"MT", "MTS"},
    "islands": {"ISL", "ISLET"},
    "valleys": {"VAL"},
    "points": {"PT"},
    "peaks": {"PK"},
    "ridges": {"RDGE"},
    "passes": {"PASS"},
    # everything else in T falls into "other_terrain"
}

# --- Parks/areas (feature_class == "L") -----------------------------------
# Only these codes are kept; everything else in L is dropped.

PARKS_AREAS_CATEGORIES = {
    "parks": {"PRK"},
    "reserves": {"RESV", "RESN", "RESF", "RES"},
    "fields": {"FLD", "GRAZ", "OILF"},
    "industrial_districts": {"INDS"},
}

# --- Admin names (feature_class == "A") -----------------------------------

ADMIN_CATEGORIES = {
    "country": {"PCLI", "PCLD", "PCLH", "PCLIX", "TERR"},
    "state_province": {"ADM1", "ADM1H"},
    "county": {"ADM2", "ADM2H"},
    "adm3": {"ADM3", "ADM3H"},
    "adm4": {"ADM4", "ADM4H"},
    "adm5_other": {"ADM5", "ADM5H", "ADMD", "ADMDH", "PRSH", "ZN", "LTER"},
}


def load_country_continents(country_info_path) -> dict[str, str]:
    """Reads GeoNames' countryInfo.txt into a {country_code: continent_code} map."""
    cc_continent = {}
    with open(country_info_path) as f:
        for line in f:
            if line.startswith("#"):
                continue
            fields = line.rstrip("\n").split("\t")
            cc_continent[fields[0]] = fields[8]
    return cc_continent


def _lookup_category(codes, mapping: dict[str, set[str]], default: str | None):
    """Vectorized feature_code -> category lookup via a flattened code->category map."""
    code_to_category = {code: cat for cat, codes in mapping.items() for code in codes}
    result = codes.map(code_to_category)
    return result.fillna(default) if default is not None else result


def _categorize_populated_places(df, cc_continent: dict[str, str]):
    import numpy as np
    import pandas as pd

    population = pd.to_numeric(df["population"], errors="coerce").fillna(0)
    code = df["feature_code"]
    country = df["country_code"]

    category = pd.Series(np.nan, index=df.index, dtype=object)
    category[code == "PPLC"] = "capitals"
    category[(code == "PPLA") & category.isna()] = "state_capitals"

    for tier_name, threshold in POPULATION_TIERS:
        mask = category.isna() & (population >= threshold)
        category[mask] = tier_name

    # villages: below the smallest population tier (or no population data at
    # all) -- too large as one bucket, so split into CN/IN plus per-continent
    village_mask = category.isna()
    village_bucket = country.where(country.isin(VILLAGE_SPLITS), country.map(cc_continent))
    category[village_mask] = "villages_" + village_bucket[village_mask].fillna("other")

    return category


def categorize_chunk(df, cc_continent: dict[str, str]):
    """Assigns a (group, category) pair to each row; drops rows with no matching category."""
    df = df.copy()
    df["group"] = None
    df["category"] = None

    fc = df["feature_class"]

    p = fc == "P"
    df.loc[p, "group"] = "populated_places"
    df.loc[p, "category"] = _categorize_populated_places(df.loc[p], cc_continent)

    h = fc == "H"
    df.loc[h, "group"] = "hydro"
    df.loc[h, "category"] = _lookup_category(df.loc[h, "feature_code"], HYDRO_CATEGORIES, default="other_water")

    t = fc == "T"
    df.loc[t, "group"] = "terrain"
    df.loc[t, "category"] = _lookup_category(df.loc[t, "feature_code"], TERRAIN_CATEGORIES, default="other_terrain")

    l = fc == "L"
    df.loc[l, "group"] = "parks_areas"
    df.loc[l, "category"] = _lookup_category(df.loc[l, "feature_code"], PARKS_AREAS_CATEGORIES, default=None)

    a = fc == "A"
    df.loc[a, "group"] = "admin"
    df.loc[a, "category"] = _lookup_category(df.loc[a, "feature_code"], ADMIN_CATEGORIES, default=None)

    return df.dropna(subset=["category"])


# Columns kept in the per-category output CSVs -- lean on purpose, since a
# few of these buckets run into the millions of rows.
OUTPUT_COLUMNS = [
    "geonameid", "name", "latitude", "longitude",
    "population", "elevation", "feature_code", "country_code",
]


def write_category_files(input_path, cc_continent: dict[str, str], out_dir, chunksize: int = 500_000):
    """Streams allCountries.txt in chunks, categorizes each row, and appends
    it to a per-(group, category) CSV under out_dir -- the final output
    format, since points get no benefit from TopoJSON's topology sharing and
    end up several times larger than the equivalent CSV.

    Returns a {(group, category): {"path", "count", "bbox"}} map."""
    import shutil

    import pandas as pd

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stats: dict[tuple[str, str], dict] = {}

    reader = pd.read_csv(
        input_path, sep="\t", header=None, names=GEONAMES_COLUMNS,
        dtype=str, na_filter=False, chunksize=chunksize,
        quoting=3,  # QUOTE_NONE -- GeoNames rows can contain stray quote chars
    )
    for chunk in reader:
        result = categorize_chunk(chunk, cc_continent)
        lat = pd.to_numeric(result["latitude"], errors="coerce")
        lon = pd.to_numeric(result["longitude"], errors="coerce")
        for (group, category), rows in result.groupby(["group", "category"]):
            path = out_dir / group / f"{category}.csv"
            path.parent.mkdir(parents=True, exist_ok=True)
            entry = stats.setdefault((group, category), {"path": path, "count": 0, "bbox": None})
            write_header = entry["count"] == 0
            rows[OUTPUT_COLUMNS].to_csv(path, mode="a", header=write_header, index=False)
            entry["count"] += len(rows)
            row_lat, row_lon = lat[rows.index], lon[rows.index]
            bbox = [row_lon.min(), row_lat.min(), row_lon.max(), row_lat.max()]
            entry["bbox"] = bbox if entry["bbox"] is None else [
                min(entry["bbox"][0], bbox[0]), min(entry["bbox"][1], bbox[1]),
                max(entry["bbox"][2], bbox[2]), max(entry["bbox"][3], bbox[3]),
            ]

    return stats


# --- Group/category metadata for the catalog -------------------------------

GROUPS = {
    "populated_places": dict(
        name="Populated Places (GeoNames)",
        description="Cities, towns, and villages worldwide, tiered by population.",
        tags=["cities", "towns", "villages", "places", "points", "world", "geonames"],
    ),
    "hydro": dict(
        name="Water Features (GeoNames)",
        description="Named rivers, lakes, and other water features worldwide.",
        tags=["water", "rivers", "lakes", "hydrology", "points", "world", "geonames"],
    ),
    "terrain": dict(
        name="Terrain Features (GeoNames)",
        description="Named mountains, hills, islands, and other terrain features worldwide.",
        tags=["terrain", "mountains", "hills", "islands", "points", "world", "geonames"],
    ),
    "parks_areas": dict(
        name="Parks & Areas (GeoNames)",
        description="Named parks, reserves, fields, and industrial districts worldwide.",
        tags=["parks", "reserves", "areas", "points", "world", "geonames"],
    ),
    "admin": dict(
        name="Administrative Names (GeoNames)",
        description="Country, state/province, and county-level administrative names worldwide.",
        tags=["admin", "boundaries", "names", "points", "world", "geonames"],
    ),
}

CATEGORY_DISPLAY_NAMES = {
    "populated_places": {
        "capitals": "Capitals",
        "state_capitals": "State/Province Capitals",
        "major_cities": "Major Cities (1M+)",
        "cities": "Cities (100k–1M)",
        "towns": "Towns (10k–100k)",
        "small_towns": "Small Towns (1k–10k)",
        "villages_CN": "Villages — China",
        "villages_IN": "Villages — India",
        "villages_AF": "Villages — Africa",
        "villages_AS": "Villages — Asia",
        "villages_EU": "Villages — Europe",
        "villages_NA": "Villages — North America",
        "villages_OC": "Villages — Oceania",
        "villages_SA": "Villages — South America",
        "villages_AN": "Villages — Antarctica",
        "villages_other": "Villages — Other",
    },
    "hydro": {
        "rivers_streams": "Rivers & Streams",
        "lakes": "Lakes",
        "bays": "Bays",
        "coves_inlets": "Coves & Inlets",
        "canals": "Canals",
        "wells_ponds_reservoirs_springs": "Wells, Ponds, Reservoirs & Springs",
        "marsh_swamp": "Marsh & Swamp",
        "other_water": "Other Water Features",
    },
    "terrain": {
        "hills": "Hills",
        "mountains": "Mountains",
        "islands": "Islands",
        "valleys": "Valleys",
        "points": "Points",
        "peaks": "Peaks",
        "ridges": "Ridges",
        "passes": "Passes",
        "other_terrain": "Other Terrain",
    },
    "parks_areas": {
        "parks": "Parks",
        "reserves": "Reserves",
        "fields": "Fields",
        "industrial_districts": "Industrial Districts",
    },
    "admin": {
        "country": "Country Names",
        "state_province": "State/Province Names",
        "county": "County Names",
        "adm3": "ADM3 Names",
        "adm4": "ADM4 Names",
        "adm5_other": "ADM5 & Other Division Names",
    },
}

class GeoNames(DataSource):
    def fetch(self) -> list[DatasetMeta]:
        raw_dir = Path(__file__).parent.parent / "raw_data/geonames"
        data_path = raw_dir / "allCountries.txt"
        country_info_path = raw_dir / "countryInfo.txt"

        if not data_path.exists():
            print(f"[geonames] WARNING: {data_path} not found, skipping", flush=True)
            return []

        cc_continent = load_country_continents(country_info_path)

        t0 = time.time()
        print("\n  Categorizing allCountries.txt...", flush=True)
        category_stats = write_category_files(data_path, cc_continent, self.output_dir / "geonames")
        print(f"      Done in {time.time() - t0:.1f}s, {len(category_stats)} category files", flush=True)

        # One standalone dataset per category (each its own CSV file), NOT grouped
        # into a few multi-layer datasets — so loading e.g. "Lakes" doesn't pull in
        # every water feature. Group tags are carried through for catalog filtering.
        results = []
        for (group, category), stats in sorted(category_stats.items()):
            display_name = CATEGORY_DISPLAY_NAMES[group].get(category, category)
            print(f"      {display_name}: {stats['count']:,} features, "
                  f"{stats['path'].stat().st_size / 1024 / 1024:.1f}MB", flush=True)
            results.append(DatasetMeta(
                id=f"geonames/{group}-{category}".replace("_", "-"),
                name=display_name,
                description=f"{display_name} worldwide — GeoNames point data.",
                source="geonames",
                source_name="GeoNames",
                admin_level=0,
                region="world",
                license="CC-BY 4.0",
                tags=GROUPS[group]["tags"],
                file_path=str(stats["path"].relative_to(self.output_dir)),
                feature_count=stats["count"],
                bbox=stats["bbox"] or [-180, -90, 180, 90],
                geometry_type="Point",
            ))

        elapsed = time.time() - t0
        print(f"\n  ✓ GeoNames complete in {elapsed:.1f}s ({len(results)} datasets)", flush=True)
        return results
