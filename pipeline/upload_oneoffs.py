"""
Local upload of the one-off source outputs (WDPA, GeoNames, HydroRIVERS) to R2.

These sources are processed manually and their large outputs live only on local
disk (gitignored), so the automated CI pipeline can't upload them. This script
does it from your machine, reading R2 credentials from app/.env.

Recommended sequence when a one-off's data changes:
    1. python -m pipeline.<source>_once      # regenerate + compress (+ manifest)
    2. python -m pipeline.upload_oneoffs      # push the data to R2   <-- this
    3. git add pipeline/manifests && commit && push
    4. run the "Update Geodata" workflow      # rebuilds catalog.json to include them

catalog.json is intentionally NOT written here. It's rebuilt by the full pipeline
run (live regular sources + committed manifests); building it here would drop the
regular sources, since this script doesn't fetch them. Upload the data first, then
let the pipeline refresh the catalog so it never points at files that aren't on R2.

Run with:
    pipeline/.venv/bin/python3 -m pipeline.upload_oneoffs
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from .upload import upload_directory

PIPELINE_DIR = Path(__file__).parent
ENV_PATH = PIPELINE_DIR.parent / "app/.env"

# (label, output dir) per one-off source. Each dir's files upload under R2 keys
# relative to it — e.g. raw_data/wdpa/output/wdpa/points.topojson → wdpa/points.topojson.
ONE_OFFS = [
    ("WDPA", PIPELINE_DIR / "raw_data/wdpa/output"),
    ("GeoNames", PIPELINE_DIR / "raw_data/geonames/output"),
    ("HydroRIVERS", PIPELINE_DIR / "raw_data/hydrorivers/output"),
    ("HydroLAKES", PIPELINE_DIR / "raw_data/hydrolakes/output"),
]

REQUIRED = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]


def load_env():
    if not ENV_PATH.exists():
        sys.exit(f"ERROR: {ENV_PATH} not found — can't load R2 credentials.")
    load_dotenv(ENV_PATH)
    # The app names the public URL PUBLIC_R2_URL; the pipeline reads R2_PUBLIC_URL.
    if os.environ.get("PUBLIC_R2_URL") and not os.environ.get("R2_PUBLIC_URL"):
        os.environ["R2_PUBLIC_URL"] = os.environ["PUBLIC_R2_URL"]
    missing = [k for k in REQUIRED if not os.environ.get(k)]
    if missing:
        sys.exit(
            f"ERROR: missing R2 credentials in {ENV_PATH}: {', '.join(missing)}\n"
            f"Add them UNPREFIXED (not PUBLIC_, or they'd leak into the web bundle) "
            f"and re-run."
        )


def main():
    load_env()
    bucket = os.environ["R2_BUCKET_NAME"]

    dirs = [(label, d) for label, d in ONE_OFFS if d.exists() and any(d.rglob("*.br"))]
    if not dirs:
        sys.exit(
            "No one-off outputs with .br sidecars found. Run the *_once.py runners "
            "first to generate and compress them."
        )

    print(f"Uploading {len(dirs)} one-off source(s) to R2 bucket '{bucket}':")
    for label, d in dirs:
        print(f"\n{'='*50}\n  {label} → R2\n{'='*50}")
        upload_directory(d, bucket)

    print(
        "\n✓ One-off upload complete. Next: commit pipeline/manifests, push, and run "
        "the Update Geodata workflow so catalog.json picks up these datasets."
    )


if __name__ == "__main__":
    main()
