import os

# R2 (Cloudflare) object storage, accessed via the S3-compatible API (boto3).
R2_ENDPOINT = os.environ.get("R2_ENDPOINT", "")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET = os.environ.get("R2_BUCKET", "anu")

MAPBOX_ACCESS_TOKEN = os.environ.get("MAPBOX_ACCESS_TOKEN", "")

ML_MODEL_VERSION = os.environ.get("ML_MODEL_VERSION", "v1.0")

PROPERTY_BBOX_SIZE_M = 40
MIN_ROOF_AREA_M2 = 20
MIN_LIDAR_POINTS = 100
MAX_RETRIES = 3
