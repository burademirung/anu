"""R2 (Cloudflare) object storage operations for the Anu ML service.

Uses the S3-compatible API via boto3, pointed at an R2 bucket. The container
holds the R2 credentials in env; it never touches the database.
"""

import boto3

from app.config import (
    R2_ENDPOINT,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET,
)

_s3 = None


def _client():
    global _s3
    if _s3 is None:
        _s3 = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            region_name="auto",
        )
    return _s3


def upload_bytes(key: str, data: bytes, content_type: str) -> str:
    _client().put_object(Bucket=R2_BUCKET, Key=key, Body=data, ContentType=content_type)
    return key


def upload_pdf(report_id: str, data: bytes) -> str:
    return upload_bytes(f"reports/{report_id}/report.pdf", data, "application/pdf")


def upload_overlay(report_id: str, data: bytes) -> str:
    return upload_bytes(f"reports/{report_id}/overlay.png", data, "image/png")


def upload_imagery(key: str, data: bytes) -> str:
    return upload_bytes(key, data, "image/png")
