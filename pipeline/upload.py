import os
from pathlib import Path

import boto3
from botocore.config import Config


CONTENT_TYPES = {
    ".json": "application/json",
    ".topojson": "application/json",
    ".geojson": "application/json",
    ".csv": "text/csv",
}


def get_client():
    account_id = os.environ["R2_ACCOUNT_ID"]
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def upload_directory(local_dir: Path, bucket: str):
    client = get_client()
    uploaded = 0
    for file_path in sorted(local_dir.rglob("*")):
        # Skip dotfiles (.DS_Store etc.) and `.br` sidecars — the latter are
        # uploaded via their base file below, not on their own.
        if not file_path.is_file() or file_path.name.startswith(".") or file_path.name.endswith(".br"):
            continue
        key = str(file_path.relative_to(local_dir))
        extra = {
            "ContentType": CONTENT_TYPES.get(file_path.suffix, "application/octet-stream"),
            "CacheControl": "public, max-age=86400",
        }

        # If a brotli sidecar exists, upload *its* bytes under the base key with
        # a Content-Encoding header — the browser decodes transparently, so the
        # app fetches the same URL and never sees compressed data.
        source = file_path
        br_path = file_path.parent / (file_path.name + ".br")
        if br_path.exists():
            source = br_path
            extra["ContentEncoding"] = "br"

        size_kb = source.stat().st_size // 1024
        print(f"  Uploading {key} ({size_kb}KB){' [br]' if source is br_path else ''}...")
        client.upload_file(str(source), bucket, key, ExtraArgs=extra)
        uploaded += 1
    print(f"Uploaded {uploaded} files to R2 bucket '{bucket}'")
