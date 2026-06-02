#!/usr/bin/env bash
set -euo pipefail

echo "=== Anu Dev Setup ==="

# Copy env if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

# Install web dependencies
echo "Installing web dependencies..."
cd web && npm install && cd ..

# Start infrastructure
echo "Starting Docker infrastructure..."
docker compose up -d postgres redis minio

# Wait for Postgres
echo "Waiting for Postgres..."
until docker compose exec -T postgres pg_isready -U anu 2>/dev/null; do
  sleep 1
done

# Run migrations
echo "Running database migrations..."
cd web
DATABASE_URL="postgresql://anu:anu_dev@localhost:5432/anu" npx prisma migrate dev
cd ..

# Create MinIO bucket
echo "Creating MinIO bucket..."
docker compose exec -T minio mc alias set local http://localhost:9000 minioadmin minioadmin 2>/dev/null || true
docker compose exec -T minio mc mb local/anu --ignore-existing 2>/dev/null || true

echo ""
echo "=== Setup complete! ==="
echo "Run: cd web && npm run dev"
echo "Open: http://localhost:3000"
