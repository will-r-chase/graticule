import os
from pathlib import Path

import boto3
from botocore.config import Config


CONTENT_TYPES = {
    ".json": "application/json",
    ".topojson": "application/json",
    ".geojson": "application/json",
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
        if not file_path.is_file():
            continue
        key = str(file_path.relative_to(local_dir))
        content_type = CONTENT_TYPES.get(file_path.suffix, "application/octet-stream")
        size_kb = file_path.stat().st_size // 1024
        print(f"  Uploading {key} ({size_kb}KB)...")
        client.upload_file(
            str(file_path),
            bucket,
            key,
            ExtraArgs={
                "ContentType": content_type,
                "CacheControl": "public, max-age=86400",
            },
        )
        uploaded += 1
    print(f"Uploaded {uploaded} files to R2 bucket '{bucket}'")
