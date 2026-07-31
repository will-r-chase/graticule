"""
One-off HydroLAKES pull — not part of the regular pipeline run (see run.py).

Run with:
    pipeline/.venv/bin/python3 -m pipeline.run_hydrolakes_once

Reads the global shapefile zip (HydroLAKES_polys_v10_shp.zip) dropped in
pipeline/raw_data/hydrolakes/ and writes per-continent simplified TopoJSON layers
to pipeline/raw_data/hydrolakes/output/ (gitignored), writes the catalog manifest,
then brotli-compresses the outputs into .br sidecars. Upload to R2 is deferred and
handled by upload_oneoffs.py (R2 creds live only locally / on the GitHub worker).
"""

from pathlib import Path

from . import catalog
from .compress import compress_dir
from .sources.hydrolakes import HydroLakes

OUTPUT_DIR = Path(__file__).parent / "raw_data/hydrolakes/output"

if __name__ == "__main__":
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    results = HydroLakes(OUTPUT_DIR).fetch()
    for d in results:
        p = OUTPUT_DIR / d.file_path
        size_mb = p.stat().st_size / (1024 * 1024)
        print(f"  {d.name}: {d.feature_count:,} lakes, {size_mb:.1f}MB -> {d.file_path}")

    catalog.write_manifest("hydrolakes", results)

    print("\nCompressing outputs (brotli → .br sidecars)...")
    compress_dir(OUTPUT_DIR)
