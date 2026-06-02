# Anu — Deployment (Cloudflare)

> Operator runbook. Every step needs an authenticated Cloudflare account (Workers Paid
> plan) and a Docker daemon (colima works headless — needed only to build the ML container
> image). Run these from `web/` unless noted.

**Live URL:** `https://anu-web.burademirung.workers.dev`

**Goal:** Provision the Cloudflare resources, set secrets, build+push the ML container, deploy the Worker, and verify a real report end-to-end.

**Prereqs:** Workers Paid plan (Containers + Queues + Durable Objects need it); Docker running (for the container image build only).

---

## Step 0 — Authenticate
```bash
cd web
npx wrangler login          # opens a browser; authorizes wrangler on your account
npx wrangler whoami         # confirm the right account
```

## Step 1 — Provision resources
The names must match `web/wrangler.jsonc` (`anu`, `anu-reports`, `anu-reports-dlq`).
```bash
# D1 — capture the returned database_id
npx wrangler d1 create anu
# R2 bucket
npx wrangler r2 bucket create anu
# Queues (main + dead-letter)
npx wrangler queues create anu-reports
npx wrangler queues create anu-reports-dlq
```
**Then edit `web/wrangler.jsonc`:** replace the D1 `"database_id": "local-placeholder-..."` with the real id printed by `d1 create`. Commit that change.

## Step 2 — Apply the schema to the REMOTE D1
```bash
npx wrangler d1 migrations apply anu --remote
npx wrangler d1 execute anu --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
# expect: properties, report_edges, report_facets, reports, users
```

## Step 3 — Create an R2 API token for the CONTAINER
The container uploads PDFs/overlays/imagery to R2 over the S3 API, so it needs S3
credentials (Workers bindings don't reach into a container). In the Cloudflare dashboard:
**R2 → Manage R2 API Tokens → Create (Object Read & Write, bucket `anu`).** Note the
Access Key ID, Secret Access Key, and the S3 endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

## Step 4 — Set Worker secrets
```bash
npx wrangler secret put NEXTAUTH_SECRET        # a random 32+ char string
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put R2_ENDPOINT            # https://<ACCOUNT_ID>.r2.cloudflarestorage.com
npx wrangler secret put R2_BUCKET              # anu
# optional Google OAuth:
# npx wrangler secret put GOOGLE_CLIENT_ID
# npx wrangler secret put GOOGLE_CLIENT_SECRET
```

No `DATABASE_URL` is needed — the D1 database is accessed via the `DB` Workers binding.
Geocoding uses the US Census Geocoder (no API key required).
Stripe secrets are **not required** (billing is unused; the Stripe code is inert).
`MAPBOX_ACCESS_TOKEN` is optional — the container may use it for fallback aerial imagery,
but geocoding works without it.

## Step 5 — Provide the container's env (R2 creds)
The ML container reads `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET`. Set these as **container** env vars (NOT Worker secrets).
In `web/wrangler.jsonc`, the `containers[0]` entry takes secret env via the dashboard or, for
non-secret values, an `envvars`/`vars` map. Recommended: set the R2 secret values through the
**dashboard → the Worker → the container's variables/secrets**, and put `R2_BUCKET=anu` +
the `R2_ENDPOINT` (non-secret) in the container config. (Confirm the exact field names against
the current Containers docs — beta; the agent used `@cloudflare/containers@0.3.6`.)

## Step 6 — Pre-build and push the ML container image
The ML container image must be **pre-built and pushed** before deploying. Using
`wrangler deploy` alone to build the image from a Dockerfile breaks when OpenNext's deploy
wrapper delegates to `wrangler` — the `containers` binding causes a crash. Instead, build
and push the image explicitly, then reference it as a registry image in `wrangler.jsonc`.

```bash
# Build and push the container image (requires Docker / colima running).
# Bump the tag whenever ml-service changes and match it in wrangler.jsonc.
wrangler containers build ../ml-service -t anu-ml:v2 -p
```

> **Container image rollout gotcha.** Bumping the image + `wrangler deploy` only changes
> the container *application* config; warm instances (`sleepAfter = "10m"`, keyed per
> report id) keep the old image until they recycle. After deploy, watch
> `wrangler containers list` until `STATE` returns to `active` (it shows `provisioning`
> during rollout) before testing, or you'll hit the previous image.

## Step 7 — Build and deploy the Worker
`OPEN_NEXT_DEPLOY=1` bypasses OpenNext's deploy wrapper (which crashes on the `containers`
binding). NextAuth's `trustHost: true` is already set in the auth config, which is required
for `*.workers.dev` domains.

```bash
npm run cf:build                             # opennextjs-cloudflare build -> .open-next/worker.js
OPEN_NEXT_DEPLOY=1 npx wrangler deploy      # deploy the Worker + all bindings
```

The live URL is `https://anu-web.burademirung.workers.dev`.

## Step 8 — Smoke test the live deployment
```bash
curl -s https://anu-web.burademirung.workers.dev/api/health      # {"status":"ok","service":"anu-web"}
```
Then in a browser: register → log in → create a report for a US address. Watch it move
`queued → processing → completed` (the StatusPoller refreshes the page). Every report is a
**full** report (real OSM footprint + LiDAR pitch where available, otherwise an estimated
hip-roof — never blank/`basic`). Confirm the **satellite map** renders with the roof
highlighted and the PDF downloads. This exercises the full path: Worker → Queue →
consumer → **Container `/process`** → R2 + D1 → report viewer. (First container call has a
cold-start; subsequent calls reuse the warm instance until `sleepAfter`.)

Also verify the **on-map editor**: click **Edit roof**, drag/reshape the outline, change
pitch, and **Save** — the report's facets/measurements update from the traced outline
(`POST /api/reports/[id]/geometry`, no container needed). And **Re-run** / **Delete**.

You can also use the seeded demo accounts (`demo@anu.dev` / `solo@anu.dev`, password
`AnuDemo2026!`) to verify the report viewer with pre-existing data.

## Step 9 — Observe / troubleshoot
```bash
npx wrangler tail                              # live Worker logs (producer + queue consumer)
npx wrangler queues consumer ... # inspect queue depth via dashboard
npx wrangler d1 execute anu --remote --command \
  "SELECT status, count(*) FROM reports GROUP BY status;"
```
If reports stay `queued`: check the consumer is bound (it's the same Worker's `queue()`
handler). If they go `failed`: `wrangler tail` shows the consumer error — usually the
container `/process` returned non-2xx (check container logs in the dashboard) or R2 creds.

---

## Rollback
This deploys a brand-new Worker/stack; the old Docker-Compose/droplet deployment is untouched
and can keep serving until you cut DNS/traffic over. To roll back, just don't point users at
the workers.dev URL. `wrangler rollback` reverts the Worker to the previous deployment.

## What's intentionally deferred (post-launch iterations, see spec "out of scope")
- Stale-job recovery + 90-day cleanup → Cloudflare **Cron Triggers** (the old Docker cron
  scripts were deleted; rewrite as `scheduled()` handlers).
- Cross-user imagery cache.
- Custom domain (currently `*.workers.dev`).
- Password reset email (Resend) / Google OAuth (env-gated, secrets optional).

## Done = success criteria
- `GET /api/health` 200 on the live URL.
- A US-address report completes end-to-end with overlay + PDF.
- `reports` table on remote D1 shows a `completed` row with facets/edges and R2 object keys.
