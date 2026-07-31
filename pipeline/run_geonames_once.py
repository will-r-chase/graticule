"""
One-off GeoNames pull — not part of the regular pipeline run (see run.py).

Run with:
    pipeline/.venv/bin/python3 -m pipeline.run_geonames_once

Reads allCountries.txt and countryInfo.txt from pipeline/raw_data/geonames/
and writes the converted TopoJSON layers to
pipeline/raw_data/geonames/output/ (gitignored — not committed).
"""

from pathlib import Path

from . import catalog
from .sources.geonames import GeoNames

OUTPUT_DIR = Path(__file__).parent / "raw_data/geonames/output"

if __name__ == "__main__":
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    results = GeoNames(OUTPUT_DIR).fetch()
    for d in results:
        print(f"\n{d.name}: {d.feature_count:,} features total, {len(d.layers)} layers")
        for layer in d.layers:
            p = OUTPUT_DIR / layer.file_path
            size_mb = p.stat().st_size / (1024 * 1024)
            print(f"  {layer.name} ({layer.object_name}): {size_mb:.1f} MB -> {layer.file_path}")

    catalog.write_manifest("geonames", results)
