FROM ghcr.io/osgeo/gdal:ubuntu-small-3.9.3 AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-pip python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt

COPY app/ app/

# Run as a non-root user to limit blast radius if the process is compromised.
RUN useradd --system --create-home appuser && chown -R appuser /app
USER appuser

# Stateless container: serves POST /process (no Celery worker, no DB).
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
