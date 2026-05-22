"""
Main pipeline entry point.

Run with:
    python -m pipeline.run

Required environment variables:
    R2_ACCOUNT_ID
    R2_ACCESS_KEY_ID
    R2_SECRET_ACCESS_KEY
    R2_BUCKET_NAME
    R2_PUBLIC_URL   (public base URL of your R2 bucket, e.g. https://pub-xxx.r2.dev)
"""

import os
import sys
import tempfile
import time
from pathlib import Path

from . import catalog, upload
from .sources.eurostat import Eurostat
from .sources.natural_earth import NaturalEarth
from .sources.tiger import Tiger

# Sources to be re-enabled once confirmed stable:
# from .sources.project_linework import ProjectLinework
# from .sources.custom import Custom


def check_env():
    required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        print(f"ERROR: missing environment variables: {', '.join(missing)}")
        sys.exit(1)


def main():
    check_env()
    bucket = os.environ["R2_BUCKET_NAME"]
    t_start = time.time()

    with tempfile.TemporaryDirectory() as tmp:
        output_dir = Path(tmp)
        all_datasets = []
        errors = []

        sources = [
            ("Natural Earth", NaturalEarth(output_dir)),
            ("Tiger", Tiger(output_dir)),
            ("Eurostat", Eurostat(output_dir)),
            # ("Project Linework", ProjectLinework(output_dir)),
            # ("Custom", Custom(output_dir)),
        ]

        for name, source in sources:
            print(f"\n{'='*50}", flush=True)
            print(f"  {name}", flush=True)
            print(f"{'='*50}", flush=True)
            t0 = time.time()
            try:
                datasets = source.fetch()
                all_datasets.extend(datasets)
                elapsed = time.time() - t0
                print(f"\n  ✓ {len(datasets)} dataset(s) in {elapsed:.1f}s", flush=True)
            except Exception as e:
                elapsed = time.time() - t0
                errors.append((name, str(e)))
                print(f"\n  ✗ FAILED after {elapsed:.1f}s: {e}", flush=True)

        print(f"\n{'='*50}", flush=True)
        print(f"  Catalog", flush=True)
        print(f"{'='*50}", flush=True)
        catalog.build(all_datasets, output_dir)

        print(f"\n{'='*50}", flush=True)
        print(f"  Upload → R2 ({bucket})", flush=True)
        print(f"{'='*50}", flush=True)
        upload.upload_directory(output_dir, bucket)

    total = time.time() - t_start
    print(f"\n{'='*50}", flush=True)
    if errors:
        print(f"  Completed with {len(errors)} error(s) in {total:.1f}s", flush=True)
        for name, err in errors:
            print(f"  ✗ {name}: {err}", flush=True)
        sys.exit(1)
    else:
        print(f"  ✓ Done — {len(all_datasets)} datasets in {total:.1f}s", flush=True)


if __name__ == "__main__":
    main()
