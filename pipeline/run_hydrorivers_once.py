"""
One-off HydroRIVERS pull — not part of the regular pipeline run (see run.py).

Run with:
    pipeline/.venv/bin/python3 -m pipeline.run_hydrorivers_once

Reads the regional shapefile zips (HydroRIVERS_v10_XX_shp.zip) dropped in
pipeline/raw_data/hydrorivers/ and writes trimmed TopoJSON layers to
pipeline/raw_data/hydrorivers/output/ (gitignored), then brotli-compresses them
into .br sidecars. Upload to R2 is deferred — the one-off outputs are pushed
separately (R2 creds live only on the GitHub worker).
"""

from pathlib import Path

from . import catalog
from .compress import compress_dir
from .sources.hydrorivers import HydroRivers

OUTPUT_DIR = Path(__file__).parent / "raw_data/hydrorivers/output"

if __name__ == "__main__":
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    results = HydroRivers(OUTPUT_DIR).fetch()
    for d in results:
        p = OUTPUT_DIR / d.file_path
        size_mb = p.stat().st_size / (1024 * 1024)
        print(f"  {d.name}: {d.feature_count:,} reaches, {size_mb:.1f}MB -> {d.file_path}")

    catalog.write_manifest("hydrorivers", results)

    print("\nCompressing outputs (brotli → .br sidecars)...")
    compress_dir(OUTPUT_DIR)
