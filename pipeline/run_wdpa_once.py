"""
One-off WDPA pull — not part of the regular pipeline run (see run.py).

Run with:
    pipeline/.venv/bin/python3 -m pipeline.run_wdpa_once

Reads the zip dropped in pipeline/raw_data/wdpa/ and writes the converted
TopoJSON layers to pipeline/raw_data/wdpa/output/ (gitignored — not committed).
"""

from pathlib import Path

from .sources.wdpa import WDPA

OUTPUT_DIR = Path(__file__).parent / "raw_data/wdpa/output"

if __name__ == "__main__":
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    results = WDPA(OUTPUT_DIR).fetch()
    for d in results:
        print(f"\n{d.name}: {d.feature_count:,} features total, {len(d.layers)} layers")
        for layer in d.layers:
            p = OUTPUT_DIR / layer.file_path
            size_mb = p.stat().st_size / (1024 * 1024)
            print(f"  {layer.name} ({layer.object_name}): {size_mb:.1f} MB -> {layer.file_path}")

    # NB: WDPA's manifest is NOT written here — fetch() reports pre-rename IUCN
    # codes, but rename_wdpa_layers_once.py renames the layers afterward. The
    # manifest is generated from the final on-disk files by
    # generate_manifests_once.py (run it after the rename step).
