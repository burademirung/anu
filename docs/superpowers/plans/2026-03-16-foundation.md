# Anu Foundation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the project infrastructure, database schema, authentication, and lib modules so that Plans 2-5 can build on a working foundation.

**Architecture:** Monorepo with two services (`web/` Next.js app, `ml-service/` FastAPI stub) orchestrated by Docker Compose. Caddy reverse proxy, Redis, MinIO, and Uptime Kuma run as infrastructure containers. Managed Postgres on DigitalOcean (local Docker Postgres for dev). NextAuth handles auth with credentials + Google OAuth.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Prisma, NextAuth v5, Tailwind CSS, Docker Compose, Caddy, Redis, MinIO, FastAPI (stub)

**Spec:** `docs/superpowers/specs/2026-03-16-anu-system-design.md`

---

## File Structure

```
anu/
├── docker-compose.yml              # all services for local dev
├── docker-compose.prod.yml         # production overrides
├── Caddyfile                       # reverse proxy config
├── .env.example                    # template for all env vars
├── .gitignore                      # updated for node_modules, .env, etc.
├── web/
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── postcss.config.mjs
│   ├── Dockerfile
│   ├── .env.local                  # gitignored, local dev overrides
│   ├── prisma/
│   │   └── schema.prisma           # full data model (5 tables, 6 enums)
│   ├── app/
│   │   ├── layout.tsx              # root layout with providers
│   │   ├── page.tsx                # landing page (minimal)
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx      # login form
│   │   │   ├── register/page.tsx   # registration form
│   │   │   └── layout.tsx          # centered auth layout
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx          # sidebar + protected route wrapper
│   │   │   └── page.tsx            # dashboard home (placeholder)
│   │   └── api/
│   │       ├── auth/
│   │       │   ├── [...nextauth]/route.ts  # NextAuth handler
│   │       │   └── register/route.ts       # user registration
│   │       └── health/route.ts     # health check endpoint
│   ├── lib/
│   │   ├── db.ts                   # Prisma client singleton
│   │   ├── auth.ts                 # NextAuth config
│   │   ├── redis.ts                # ioredis client singleton
│   │   ├── s3.ts                   # MinIO client (minio-js)
│   │   └── ml-client.ts            # HTTP client stub for ML service
│   ├── middleware.ts               # auth middleware for /dashboard/*
│   └── __tests__/
│       ├── lib/
│       │   ├── db.test.ts          # Prisma client tests
│       │   ├── redis.test.ts       # Redis client tests
│       │   ├── s3.test.ts          # MinIO client tests
│       │   └── ml-client.test.ts   # ML client tests
│       └── api/
│           └── health.test.ts      # health endpoint test
├── ml-service/
│   ├── app/
│   │   └── main.py                 # FastAPI health + stub /jobs endpoint
│   ├── requirements.txt
│   └── Dockerfile
└── scripts/
    └── dev-setup.sh                # one-command local dev bootstrap
```

---

## Chunk 1: Project Scaffolding + Docker Compose

### Task 1: Initialize Next.js project

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/next.config.ts`, `web/tailwind.config.ts`, `web/postcss.config.mjs`, `web/app/layout.tsx`, `web/app/page.tsx`

- [ ] **Step 1: Scaffold Next.js with TypeScript + Tailwind**

```bash
cd /Users/vladka/anu
npx create-next-app@latest web --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*" --use-npm --turbopack
```

All flags specified to ensure fully non-interactive execution (no TTY prompts). `--turbopack` enables Turbopack for `next dev` (faster HMR).

- [ ] **Step 2: Verify it builds**

```bash
cd /Users/vladka/anu/web && npm run build
```

Expected: Build completes successfully.

- [ ] **Step 3: Install foundation dependencies**

```bash
cd /Users/vladka/anu/web
npm install prisma @prisma/client next-auth@beta @auth/prisma-adapter
npm install ioredis minio bcryptjs
npm install -D @types/bcryptjs vitest @vitejs/plugin-react
```

- [ ] **Step 4: Commit**

```bash
cd /Users/vladka/anu
git add web/
git commit -m "feat: scaffold Next.js app with TypeScript + Tailwind"
```

---

### Task 2: Initialize ML service stub

**Files:**
- Create: `ml-service/app/main.py`, `ml-service/requirements.txt`, `ml-service/Dockerfile`

- [ ] **Step 1: Create FastAPI health + stub jobs endpoint**

Create `ml-service/app/__init__.py` (empty) and `ml-service/app/main.py`:

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Anu ML Service")


class JobRequest(BaseModel):
    report_id: str
    property_id: str
    lat: float
    lon: float


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/jobs", status_code=202)
def create_job(req: JobRequest):
    # Stub: will be implemented in Plan 2 (ML Pipeline)
    return {"status": "accepted", "report_id": req.report_id}
```

- [ ] **Step 2: Create requirements.txt**

Create `ml-service/requirements.txt`:

```
fastapi==0.115.0
uvicorn[standard]==0.32.0
pydantic==2.10.0
```

- [ ] **Step 3: Create Dockerfile**

Create `ml-service/Dockerfile`:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 4: Verify it runs locally**

```bash
cd /Users/vladka/anu/ml-service
pip install -r requirements.txt
uvicorn app.main:app --port 8000 &
curl http://localhost:8000/health
kill %1
```

Expected: `{"status":"ok"}`

- [ ] **Step 5: Commit**

```bash
cd /Users/vladka/anu
git add ml-service/
git commit -m "feat: add FastAPI ML service stub with health + jobs endpoints"
```

---

### Task 3: Create Docker Compose for local dev

**Files:**
- Create: `docker-compose.yml`, `Caddyfile`, `.env.example`, update `.gitignore`

- [ ] **Step 1: Create docker-compose.yml**

Create `docker-compose.yml`:

```yaml
services:
  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
      - caddy-config:/config
    depends_on: [web]
    restart: unless-stopped

  web:
    build: ./web
    expose: ["3000"]
    env_file: .env
    depends_on:
      redis:
        condition: service_healthy
      postgres:
        condition: service_healthy
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 1G

  ml-service:
    build: ./ml-service
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000
    expose: ["8000"]
    env_file: .env
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 512M

  # Stub for local dev — activated fully in Plan 2 (ML Pipeline)
  ml-worker:
    build: ./ml-service
    command: echo "ML worker disabled in foundation plan. Activate in Plan 2."
    env_file: .env
    depends_on:
      redis:
        condition: service_healthy
    restart: "no"
    profiles: ["ml"]  # only starts with: docker compose --profile ml up

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: anu
      POSTGRES_USER: anu
      POSTGRES_PASSWORD: anu_dev
    ports: ["5432:5432"]
    volumes: ["pg-data:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U anu"]
      interval: 5s
      timeout: 5s
      retries: 5
      start_period: 10s

  redis:
    image: redis:7-alpine
    # Port exposed to host for local dev (redis-cli, debugging).
    # Production uses internal-only expose via docker-compose.prod.yml.
    ports: ["6379:6379"]
    volumes: ["redis-data:/data"]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      retries: 3

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minioadmin}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-minioadmin}
    # Ports exposed to host for local dev (S3 API access, MinIO console).
    # Production uses internal-only expose via docker-compose.prod.yml.
    ports: ["9000:9000", "9001:9001"]
    volumes: ["minio-data:/data"]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 30s
      retries: 3

  uptime-kuma:
    image: louislam/uptime-kuma:1
    volumes: ["kuma-data:/app/data"]
    expose: ["3001"]
    restart: unless-stopped

volumes:
  caddy-data:
  caddy-config:
  pg-data:
  redis-data:
  minio-data:
  kuma-data:
```

Note: Local dev uses a Docker Postgres container. Production uses DO Managed Database (no postgres service in `docker-compose.prod.yml`).

- [ ] **Step 2: Create Caddyfile for local dev**

Create `Caddyfile`:

```
:80 {
    reverse_proxy web:3000 {
        flush_interval -1
    }
}
```

Note: Local dev uses HTTP on port 80. Production Caddyfile uses `anu.com` with automatic HTTPS.

- [ ] **Step 3: Create .env.example**

Create `.env.example`:

```bash
# Database
DATABASE_URL=postgresql://anu:anu_dev@postgres:5432/anu

# Redis
REDIS_URL=redis://redis:6379/0

# Auth
NEXTAUTH_SECRET=dev-secret-change-in-production
NEXTAUTH_URL=http://localhost:3000
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=

# Stripe (test mode)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_MONTHLY=price_...
STRIPE_PRICE_YEARLY=price_...

# Mapbox
MAPBOX_ACCESS_TOKEN=pk.ey...

# MinIO server (used by Docker container)
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin

# MinIO client (used by Next.js minio-js SDK)
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=anu
MINIO_USE_SSL=false

# Email
RESEND_API_KEY=re_...

# ML Service (used by Next.js)
ML_SERVICE_URL=http://ml-service:8000

# ML Worker
ML_MODEL_VERSION=v1.0
ML_MODEL_PATH=models/unet_v1.0.pt
```

- [ ] **Step 4: Update .gitignore**

Append to `.gitignore`:

```
# Environment
.env
.env.local
.env.production

# Dependencies
node_modules/
__pycache__/
*.pyc
.venv/

# Build
.next/
out/

# Data
*.pt
*.pth
training/data/

# IDE
.idea/
.vscode/
```

- [ ] **Step 5: Create web/Dockerfile**

Create `web/Dockerfile`:

```dockerfile
FROM node:20-alpine AS base

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=base /app/.next/standalone ./
COPY --from=base /app/.next/static ./.next/static
COPY --from=base /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 6: Add standalone output to next.config.ts**

In `web/next.config.ts`, ensure the config includes:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 7: Verify Docker Compose starts infrastructure**

```bash
cd /Users/vladka/anu
cp .env.example .env
docker compose up -d postgres redis minio
docker compose ps
```

Expected: postgres, redis, minio all show "healthy" or "running".

```bash
docker compose down
```

- [ ] **Step 8: Commit**

```bash
cd /Users/vladka/anu
git add docker-compose.yml Caddyfile .env.example .gitignore web/Dockerfile web/next.config.ts
git commit -m "feat: add Docker Compose with Caddy, Postgres, Redis, MinIO for local dev"
```

---

## Chunk 2: Prisma Schema + Database

### Task 4: Create Prisma schema

**Files:**
- Create: `web/prisma/schema.prisma`

- [ ] **Step 1: Initialize Prisma**

```bash
cd /Users/vladka/anu/web
npx prisma init --datasource-provider postgresql
```

- [ ] **Step 2: Delete the generated `.env` file**

`prisma init` creates `web/.env` with a placeholder DATABASE_URL. Delete it — we use the root `.env` (via Docker Compose `env_file`) and explicit `DATABASE_URL=` prefixes for local commands.

```bash
rm -f /Users/vladka/anu/web/.env
```

- [ ] **Step 3: Write the full schema**

Replace `web/prisma/schema.prisma` with:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Plan {
  free
  premium
}

enum ReportStatus {
  queued
  processing
  completed
  failed
}

enum ReportTier {
  full
  basic
}

enum ImagerySource {
  naip
  mapbox
}

enum PitchConfidence {
  measured
  user_provided
}

enum EdgeType {
  ridge
  hip
  valley
  rake
  eave
  flashing
}

model User {
  id                    String     @id @default(uuid())
  email                 String     @unique
  name                  String
  companyName           String?    @map("company_name")
  passwordHash          String?    @map("password_hash")  // nullable: Google OAuth users have no password
  plan                  Plan       @default(free)
  stripeCustomerId      String?    @map("stripe_customer_id")
  stripeSubscriptionId  String?    @map("stripe_subscription_id")
  monthlyReportLimit    Int?       @default(5) @map("monthly_report_limit")
  createdAt             DateTime   @default(now()) @map("created_at")
  updatedAt             DateTime   @updatedAt @map("updated_at")

  properties Property[]
  reports    Report[]

  @@map("users")
}

model Property {
  id                  String         @id @default(uuid())
  userId              String         @map("user_id")
  addressRaw          String         @map("address_raw")
  addressNormalized   String         @map("address_normalized")
  lat                 Decimal
  lon                 Decimal
  parcelBoundary      Json?          @map("parcel_boundary")
  imagerySource       ImagerySource? @map("imagery_source")
  imageryCaptureDate  DateTime?      @map("imagery_capture_date") @db.Date
  imageryPath         String?        @map("imagery_path")
  lidarAvailable      Boolean?       @map("lidar_available")
  createdAt           DateTime       @default(now()) @map("created_at")
  updatedAt           DateTime       @updatedAt @map("updated_at")

  user    User     @relation(fields: [userId], references: [id])
  reports Report[]

  @@index([userId])
  @@index([lat, lon])
  @@map("properties")
}

model Report {
  id                    String        @id @default(uuid())
  propertyId            String        @map("property_id")
  userId                String        @map("user_id")
  status                ReportStatus  @default(queued)
  tier                  ReportTier?
  modelVersion          String?       @map("model_version")
  roofAreaSqft          Decimal?      @map("roof_area_sqft")
  roofAreaSquares       Decimal?      @map("roof_area_squares")
  numFacets             Int?          @map("num_facets")
  numStructures         Int?          @map("num_structures")
  wasteFactor           Decimal?      @map("waste_factor")
  confidenceScore       Decimal?      @map("confidence_score")
  pdfUrl                String?       @map("pdf_url")
  overlayUrl            String?       @map("overlay_url")
  retryCount            Int           @default(0) @map("retry_count")
  errorMessage          String?       @map("error_message")
  processingStartedAt   DateTime?     @map("processing_started_at")
  processingCompletedAt DateTime?     @map("processing_completed_at")
  createdAt             DateTime      @default(now()) @map("created_at")
  updatedAt             DateTime      @updatedAt @map("updated_at")

  property Property      @relation(fields: [propertyId], references: [id])
  user     User          @relation(fields: [userId], references: [id])
  facets   ReportFacet[]
  edges    ReportEdge[]

  @@index([userId, createdAt])
  @@index([status])
  @@index([userId, status])
  @@map("reports")
}

model ReportFacet {
  id                String           @id @default(uuid())
  reportId          String           @map("report_id")
  structureIndex    Int              @map("structure_index")
  facetIndex        Int              @map("facet_index")
  footprintAreaSqft Decimal          @map("footprint_area_sqft")
  areaSqft          Decimal          @map("area_sqft")
  pitch             String?
  pitchDegrees      Decimal?         @map("pitch_degrees")
  pitchConfidence   PitchConfidence? @map("pitch_confidence")
  orientation       String?
  polygon           Json
  createdAt         DateTime         @default(now()) @map("created_at")
  updatedAt         DateTime         @updatedAt @map("updated_at")

  report     Report       @relation(fields: [reportId], references: [id], onDelete: Cascade)
  leftEdges  ReportEdge[] @relation("LeftFacet")
  rightEdges ReportEdge[] @relation("RightFacet")

  @@index([reportId])
  @@map("report_facets")
}

model ReportEdge {
  id           String   @id @default(uuid())
  reportId     String   @map("report_id")
  edgeType     EdgeType @map("edge_type")
  lengthFt     Decimal  @map("length_ft")
  geometry     Json
  leftFacetId  String?  @map("left_facet_id")
  rightFacetId String?  @map("right_facet_id")

  report     Report       @relation(fields: [reportId], references: [id], onDelete: Cascade)
  leftFacet  ReportFacet? @relation("LeftFacet", fields: [leftFacetId], references: [id], onDelete: SetNull)
  rightFacet ReportFacet? @relation("RightFacet", fields: [rightFacetId], references: [id], onDelete: SetNull)

  @@index([reportId])
  @@map("report_edges")
}
```

- [ ] **Step 4: Validate the schema**

```bash
cd /Users/vladka/anu/web
DATABASE_URL="postgresql://anu:anu_dev@localhost:5432/anu" npx prisma validate
```

Expected: "The schema is valid."

- [ ] **Step 5: Start Postgres and run migration**

```bash
cd /Users/vladka/anu
docker compose up -d postgres
sleep 3
cd web
DATABASE_URL="postgresql://anu:anu_dev@localhost:5432/anu" npx prisma migrate dev --name init
```

Expected: Migration created and applied. `prisma/migrations/` directory created.

- [ ] **Step 6: Verify with Prisma Studio**

```bash
cd /Users/vladka/anu/web
DATABASE_URL="postgresql://anu:anu_dev@localhost:5432/anu" npx prisma studio
```

Expected: Browser opens showing all 5 tables with correct columns. Close with Ctrl+C.

- [ ] **Step 7: Commit**

```bash
cd /Users/vladka/anu
git add web/prisma/
git commit -m "feat: add Prisma schema with all 5 tables, enums, indexes, and cascade rules"
```

---

### Task 5: Create Prisma client singleton

**Files:**
- Create: `web/lib/db.ts`, `web/__tests__/lib/db.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/__tests__/lib/db.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("db", () => {
  it("exports a PrismaClient instance", async () => {
    const { db } = await import("@/lib/db");
    expect(db).toBeDefined();
    expect(db).toHaveProperty("user");
    expect(db).toHaveProperty("property");
    expect(db).toHaveProperty("report");
    expect(db).toHaveProperty("reportFacet");
    expect(db).toHaveProperty("reportEdge");
  });
});
```

- [ ] **Step 2: Create vitest config**

Create `web/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

Add to `web/package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /Users/vladka/anu/web && npx vitest run __tests__/lib/db.test.ts
```

Expected: FAIL — cannot find module `@/lib/db`

- [ ] **Step 4: Write the implementation**

Create `web/lib/db.ts`:

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/vladka/anu/web && npx vitest run __tests__/lib/db.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/vladka/anu
git add web/lib/db.ts web/__tests__/lib/db.test.ts web/vitest.config.ts web/package.json
git commit -m "feat: add Prisma client singleton with test"
```

---

## Chunk 3: Auth (NextAuth)

### Task 6: Configure NextAuth

**Files:**
- Create: `web/lib/auth.ts`, `web/app/api/auth/[...nextauth]/route.ts`, `web/middleware.ts`

- [ ] **Step 1: Create NextAuth config**

Create `web/lib/auth.ts`:

```typescript
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await db.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user || !user.passwordHash) return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );

        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
    // Google OAuth is env-gated. To enable it, you also need:
    // 1. Add an Account model to the Prisma schema (for OAuth provider linking)
    // 2. Configure PrismaAdapter in this NextAuth config
    // 3. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env
    // This is deferred to a later plan. Credentials auth works without it.
    ...(process.env.GOOGLE_CLIENT_ID
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          }),
        ]
      : []),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
});
```

- [ ] **Step 2: Create NextAuth route handler**

Create `web/app/api/auth/[...nextauth]/route.ts`:

```typescript
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 3: Create auth middleware**

Create `web/middleware.ts`:

```typescript
import { auth } from "@/lib/auth";

export default auth((req) => {
  const isAuthenticated = !!req.auth;
  const isDashboard = req.nextUrl.pathname.startsWith("/dashboard");

  if (isDashboard && !isAuthenticated) {
    return Response.redirect(new URL("/login", req.nextUrl.origin));
  }
});

export const config = {
  matcher: ["/dashboard/:path*"],
};
```

- [ ] **Step 4: Commit**

```bash
cd /Users/vladka/anu
git add web/lib/auth.ts web/app/api/auth/ web/middleware.ts
git commit -m "feat: add NextAuth with credentials + Google OAuth, JWT sessions, dashboard middleware"
```

---

### Task 7: Create auth pages (login + register)

**Files:**
- Create: `web/app/(auth)/layout.tsx`, `web/app/(auth)/login/page.tsx`, `web/app/(auth)/register/page.tsx`

- [ ] **Step 1: Create auth layout**

Create `web/app/(auth)/layout.tsx`:

```tsx
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md">
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create login page**

Create `web/app/(auth)/login/page.tsx`:

```tsx
"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);

    const result = await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Invalid email or password");
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold mb-6">Sign in to Anu</h1>
      {error && (
        <p className="text-red-600 text-sm mb-4">{error}</p>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="w-full px-3 py-2 border rounded-md"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-1">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="w-full px-3 py-2 border rounded-md"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
      <p className="mt-4 text-sm text-center">
        Don&apos;t have an account?{" "}
        <a href="/register" className="text-blue-600 hover:underline">
          Register
        </a>
      </p>
    </>
  );
}
```

- [ ] **Step 3: Create register page**

Create `web/app/(auth)/register/page.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        email: formData.get("email"),
        password: formData.get("password"),
      }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Registration failed");
    } else {
      router.push("/login");
    }
  }

  return (
    <>
      <h1 className="text-2xl font-bold mb-6">Create your account</h1>
      {error && (
        <p className="text-red-600 text-sm mb-4">{error}</p>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium mb-1">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            className="w-full px-3 py-2 border rounded-md"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="w-full px-3 py-2 border rounded-md"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-1">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            className="w-full px-3 py-2 border rounded-md"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Creating account..." : "Create account"}
        </button>
      </form>
      <p className="mt-4 text-sm text-center">
        Already have an account?{" "}
        <a href="/login" className="text-blue-600 hover:underline">
          Sign in
        </a>
      </p>
    </>
  );
}
```

- [ ] **Step 4: Create register API route**

Create `web/app/api/auth/register/route.ts`:

```typescript
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  const { name, email, password } = await req.json();

  if (!name || !email || !password) {
    return NextResponse.json(
      { error: "Name, email, and password are required" },
      { status: 400 }
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "Email already registered" },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await db.user.create({
    data: {
      name,
      email,
      passwordHash,
      plan: "free",
      monthlyReportLimit: 5,
    },
  });

  return NextResponse.json({ success: true }, { status: 201 });
}
```

- [ ] **Step 5: Commit**

```bash
cd /Users/vladka/anu
git add web/app/\(auth\)/ web/app/api/auth/register/
git commit -m "feat: add login, register pages and registration API"
```

---

### Task 8: Create dashboard layout (protected)

**Files:**
- Create: `web/app/(dashboard)/layout.tsx`, `web/app/(dashboard)/page.tsx`

- [ ] **Step 1: Create dashboard layout**

Create `web/app/(dashboard)/layout.tsx`:

```tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-gray-900 text-white p-6">
        <h2 className="text-xl font-bold mb-8">Anu</h2>
        <nav className="space-y-2">
          <Link href="/dashboard" className="block py-2 px-3 rounded hover:bg-gray-800">
            Dashboard
          </Link>
          <Link href="/dashboard/reports" className="block py-2 px-3 rounded hover:bg-gray-800">
            Reports
          </Link>
          <Link href="/dashboard/new" className="block py-2 px-3 rounded hover:bg-gray-800">
            New Report
          </Link>
          <Link href="/dashboard/settings" className="block py-2 px-3 rounded hover:bg-gray-800">
            Settings
          </Link>
        </nav>
        <div className="mt-auto pt-8 text-sm text-gray-400">
          {session.user.email}
        </div>
      </aside>
      <main className="flex-1 p-8 bg-gray-50">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Create dashboard home page**

Create `web/app/(dashboard)/page.tsx`:

```tsx
export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      <p className="text-gray-600">
        Welcome to Anu. Create a new report to get started.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/vladka/anu
git add web/app/\(dashboard\)/
git commit -m "feat: add protected dashboard layout with sidebar navigation"
```

---

## Chunk 4: Lib Modules + Health Endpoint

### Task 9: Create Redis client

**Files:**
- Create: `web/lib/redis.ts`, `web/__tests__/lib/redis.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/__tests__/lib/redis.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("ioredis", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      status: "ready",
      ping: vi.fn().mockResolvedValue("PONG"),
    })),
  };
});

describe("redis", () => {
  it("exports a Redis client instance", async () => {
    const { redis } = await import("@/lib/redis");
    expect(redis).toBeDefined();
    expect(redis).toHaveProperty("ping");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/vladka/anu/web && npx vitest run __tests__/lib/redis.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write the implementation**

Create `web/lib/redis.ts`:

```typescript
import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

export const redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL || "redis://localhost:6379/0");

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/vladka/anu/web && npx vitest run __tests__/lib/redis.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/vladka/anu
git add web/lib/redis.ts web/__tests__/lib/redis.test.ts
git commit -m "feat: add Redis client singleton with test"
```

---

### Task 10: Create MinIO client

**Files:**
- Create: `web/lib/s3.ts`, `web/__tests__/lib/s3.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/__tests__/lib/s3.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("minio", () => {
  return {
    Client: vi.fn().mockImplementation(() => ({
      bucketExists: vi.fn().mockResolvedValue(true),
      getObject: vi.fn(),
    })),
  };
});

describe("s3", () => {
  it("exports a MinIO client and bucket name", async () => {
    const { minioClient, BUCKET } = await import("@/lib/s3");
    expect(minioClient).toBeDefined();
    expect(BUCKET).toBe("anu");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/vladka/anu/web && npx vitest run __tests__/lib/s3.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write the implementation**

Create `web/lib/s3.ts`:

```typescript
import { Client } from "minio";

export const BUCKET = process.env.MINIO_BUCKET || "anu";

function parseEndpoint(endpoint: string): { host: string; port: number } {
  const parts = endpoint.split(":");
  return {
    host: parts[0],
    port: parts.length > 1 ? parseInt(parts[1], 10) : 9000,
  };
}

const { host, port } = parseEndpoint(
  process.env.MINIO_ENDPOINT || "localhost:9000"
);

export const minioClient = new Client({
  endPoint: host,
  port,
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
  secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/vladka/anu/web && npx vitest run __tests__/lib/s3.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/vladka/anu
git add web/lib/s3.ts web/__tests__/lib/s3.test.ts
git commit -m "feat: add MinIO client singleton with test"
```

---

### Task 11: Create ML service HTTP client

**Files:**
- Create: `web/lib/ml-client.ts`, `web/__tests__/lib/ml-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/__tests__/lib/ml-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("ml-client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("dispatches a job to the ML service", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 202,
      json: () => Promise.resolve({ status: "accepted" }),
    });

    const { dispatchJob } = await import("@/lib/ml-client");

    const result = await dispatchJob({
      reportId: "r-123",
      propertyId: "p-456",
      lat: 39.7392,
      lon: -104.9903,
    });

    expect(result.status).toBe("accepted");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/jobs"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("throws on ML service failure", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const { dispatchJob } = await import("@/lib/ml-client");

    await expect(
      dispatchJob({
        reportId: "r-123",
        propertyId: "p-456",
        lat: 39.7392,
        lon: -104.9903,
      })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/vladka/anu/web && npx vitest run __tests__/lib/ml-client.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write the implementation**

Create `web/lib/ml-client.ts`:

```typescript
const ML_SERVICE_URL =
  process.env.ML_SERVICE_URL || "http://localhost:8000";

interface DispatchJobParams {
  reportId: string;
  propertyId: string;
  lat: number;
  lon: number;
}

export async function dispatchJob(params: DispatchJobParams) {
  const res = await fetch(`${ML_SERVICE_URL}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      report_id: params.reportId,
      property_id: params.propertyId,
      lat: params.lat,
      lon: params.lon,
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    throw new Error(
      `ML service error: ${res.status} ${res.statusText}`
    );
  }

  return res.json();
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/vladka/anu/web && npx vitest run __tests__/lib/ml-client.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/vladka/anu
git add web/lib/ml-client.ts web/__tests__/lib/ml-client.test.ts
git commit -m "feat: add ML service HTTP client with dispatch and error handling"
```

---

### Task 12: Create health endpoint

**Files:**
- Create: `web/app/api/health/route.ts`, `web/__tests__/api/health.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/__tests__/api/health.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns 200 with status ok", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body).toHaveProperty("timestamp");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/vladka/anu/web && npx vitest run __tests__/api/health.test.ts
```

Expected: FAIL

- [ ] **Step 3: Write the implementation**

Create `web/app/api/health/route.ts`:

```typescript
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "anu-web",
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/vladka/anu/web && npx vitest run __tests__/api/health.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/vladka/anu
git add web/app/api/health/ web/__tests__/api/health.test.ts
git commit -m "feat: add health check endpoint"
```

---

### Task 13: Create dev setup script + final verification

**Files:**
- Create: `scripts/dev-setup.sh`

- [ ] **Step 1: Create bootstrap script**

Create `scripts/dev-setup.sh`:

```bash
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
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x /Users/vladka/anu/scripts/dev-setup.sh
```

- [ ] **Step 3: Run all tests**

```bash
cd /Users/vladka/anu/web && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 4: Verify Next.js builds**

```bash
cd /Users/vladka/anu/web && npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
cd /Users/vladka/anu
git add scripts/
git commit -m "feat: add dev setup bootstrap script"
```

---

## Summary

After completing this plan, you will have:

- **Docker Compose** with Caddy, Postgres (dev), Redis, MinIO — all health-checked
- **Prisma schema** with all 5 tables (users, properties, reports, report_facets, report_edges), 6 enums, all indexes, and cascade rules
- **NextAuth** with credentials + Google OAuth, JWT sessions, middleware protecting `/dashboard/*`
- **Auth pages** — login, register with form validation
- **Dashboard layout** — sidebar navigation, protected route
- **Lib modules** — Prisma client, Redis client, MinIO client, ML service HTTP client (all with tests)
- **Health endpoint** — `GET /api/health`
- **ML service stub** — FastAPI with health + jobs endpoints
- **Dev setup script** — one-command bootstrap

**Next plans to implement:**
- Plan 2: ML Pipeline (imagery, U-Net, LiDAR, plane fitting, PDF)
- Plan 3: Web App & Report Viewer (dashboard, reports, MapLibre)
- Plan 4: Billing & Limits (Stripe, rate limiting)
- Plan 5: Operations (CI/CD, cron jobs, monitoring)
