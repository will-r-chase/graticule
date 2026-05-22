"""
Main pipeline entry point.

Run with:
    python -m pipeline.run

Required environment variables:
    R2_ACCOUNT_ID
    R2_ACCESS_KEY_ID
    R2_SECRET_ACCESS_KEY
    R2_BUCKET_NAME
    R2_PUBLIC_URL   (the public base URL of your R2 bucket, e.g. https://pub-xxx.r2.dev)
"""

import os
import sys
import tempfile
from pathlib import Path

from . import catalog, upload
from .sources.custom import Custom
from .sources.eurostat import Eurostat
from .sources.natural_earth import NaturalEarth
from .sources.project_linework import ProjectLinework
from .sources.tiger import Tiger


def check_env():
    required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        print(f"ERROR: missing environment variables: {', '.join(missing)}")
        sys.exit(1)


def main():
    check_env()
    bucket = os.environ["R2_BUCKET_NAME"]

    with tempfile.TemporaryDirectory() as tmp:
        output_dir = Path(tmp)
        all_datasets = []
        errors = []

        sources = [
            ("NaturalEarth", NaturalEarth(output_dir)),
            ("Tiger", Tiger(output_dir)),
            # GADM removed: global GeoPackage is ~2.5GB, too large for CI.
            # TODO: revisit with per-country downloads or a separate workflow.
            ("Eurostat", Eurostat(output_dir)),
            ("ProjectLinework", ProjectLinework(output_dir)),
            ("Custom", Custom(output_dir)),
        ]

        for name, source in sources:
            print(f"\n=== {name} ===")
            try:
                datasets = source.fetch()
                all_datasets.extend(datasets)
                print(f"  {len(datasets)} dataset(s) processed")
            except Exception as e:
                errors.append((name, str(e)))
                print(f"  FAILED: {e}")

        print(f"\n=== Catalog ===")
        catalog.build(all_datasets, output_dir)

        print(f"\n=== Upload ===")
        upload.upload_directory(output_dir, bucket)

    if errors:
        print(f"\n=== Completed with {len(errors)} error(s) ===")
        for name, err in errors:
            print(f"  {name}: {err}")
        sys.exit(1)
    else:
        print(f"\n=== Done — {len(all_datasets)} datasets uploaded ===")


if __name__ == "__main__":
    main()
