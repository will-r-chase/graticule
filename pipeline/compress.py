"""
Brotli-compress pipeline outputs into `.br` sidecar files.

Text outputs (TopoJSON/GeoJSON/JSON/CSV) are served from R2 with a
`Content-Encoding: br` header, which browsers transparently decode — so the
app fetches the same URL and gets the decompressed data with no client-side
changes. We pre-compress to `.br` sidecars (rather than compressing inside
`upload_directory`) so the expensive brotli pass runs once, whenever the data
is produced. That also covers the one-off WDPA/GeoNames outputs, which are
compressed locally now and uploaded later; `upload_directory` ships each `.br`
under its base key with the encoding header.
"""

import time
from pathlib import Path

import brotli

# Only text formats benefit; anything else is left untouched (already
# binary/compressed, so brotli would just waste CPU).
COMPRESSIBLE_SUFFIXES = {".json", ".topojson", ".geojson", ".csv"}

# q9 is the measured sweet spot for large TopoJSON: within a few percent of
# q11's ratio but a fraction of the time (q11 is impractically slow on the
# 100MB+ files this pipeline produces).
BROTLI_QUALITY = 9


def compress_file(path: Path) -> Path | None:
    """Write a brotli `.br` sidecar next to `path`.

    Idempotent: skips work if a sidecar already exists and is at least as new
    as the source. Returns the sidecar path, or None if `path` isn't a
    compressible text type.
    """
    if path.suffix not in COMPRESSIBLE_SUFFIXES:
        return None
    out = path.parent / (path.name + ".br")
    if out.exists() and out.stat().st_mtime >= path.stat().st_mtime:
        return out
    out.write_bytes(brotli.compress(path.read_bytes(), quality=BROTLI_QUALITY))
    return out


def compress_dir(directory: Path) -> list[Path]:
    """Brotli-compress every compressible text file under `directory` into a
    `.br` sidecar. Returns the list of sidecar paths."""
    directory = Path(directory)
    written = []
    for path in sorted(directory.rglob("*")):
        if not path.is_file() or path.name.endswith(".br"):
            continue
        if path.suffix not in COMPRESSIBLE_SUFFIXES:
            continue
        out = path.parent / (path.name + ".br")
        cached = out.exists() and out.stat().st_mtime >= path.stat().st_mtime
        t0 = time.time()
        compress_file(path)
        src_mb = path.stat().st_size / 1048576
        out_mb = out.stat().st_size / 1048576
        pct = (1 - out_mb / src_mb) * 100 if src_mb else 0
        tag = "cached" if cached else f"{time.time() - t0:.1f}s"
        print(f"    {path.relative_to(directory)}: "
              f"{src_mb:.1f}→{out_mb:.1f}MB (-{pct:.0f}%, {tag})", flush=True)
        written.append(out)
    return written
