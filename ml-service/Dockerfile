FROM ghcr.io/osgeo/gdal:ubuntu-small-3.9.3 AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-pip python3-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
# --ignore-installed: the GDAL base ships numpy/Pillow via apt (no pip RECORD),
# so pip can't uninstall them to upgrade. Installing fresh into /usr/local
# (which precedes the Debian dist-packages on sys.path) avoids the conflict.
RUN pip install --no-cache-dir --break-system-packages --ignore-installed -r requirements.txt

COPY app/ app/

# Run as a non-root user to limit blast radius if the process is compromised.
RUN useradd --system --create-home appuser && chown -R appuser /app
USER appuser

# Stateless container: serves POST /process (no Celery worker, no DB).
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
