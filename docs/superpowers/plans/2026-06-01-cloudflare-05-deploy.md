# Cloudflare Migration — Plan 5 of 5: Provision & Deploy (Operator Runbook)

> **This plan is executed by YOU (the operator), not the agent.** Every step needs an
> authenticated Cloudflare account and a Docker daemon — credentials the agent doesn't have.
> Run these from `web/` unless noted. Anu is deployed to a `*.workers.dev` subdomain.

**Goal:** Provision the Cloudflare resources, set secrets, build+push the ML container, deploy the Worker, and verify a real report end-to-end.

**Prereqs:** Workers Paid plan (Containers + Queues + Durable Objects need it); Docker running (for the container image build); Stripe + Mapbox keys.

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
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put STRIPE_PRICE_MONTHLY
npx wrangler secret put STRIPE_PRICE_YEARLY
npx wrangler secret put MAPBOX_ACCESS_TOKEN
# optional Google OAuth:
# npx wrangler secret put GOOGLE_CLIENT_ID
# npx wrangler secret put GOOGLE_CLIENT_SECRET
```

## Step 5 — Provide the container's env (R2 creds + Mapbox)
The ML container reads `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET`, `MAPBOX_ACCESS_TOKEN`. Set these as **container** env vars (NOT Worker secrets).
In `web/wrangler.jsonc`, the `containers[0]` entry takes secret env via the dashboard or, for
non-secret values, an `envvars`/`vars` map. Recommended: set the R2 secret values through the
**dashboard → the Worker → the container's variables/secrets**, and put `R2_BUCKET=anu` +
the `R2_ENDPOINT` (non-secret) in the container config. (Confirm the exact field names against
the current Containers docs — beta; the agent used `@cloudflare/containers@0.3.6`.)

## Step 6 — Build, push, and deploy (builds the container image)
`wrangler deploy` builds the `../ml-service/Dockerfile` image, pushes it to Cloudflare's
registry, and deploys the Worker + all bindings.
```bash
npm run cf:build            # opennextjs-cloudflare build  -> .open-next/worker.js
npx wrangler deploy         # builds+pushes the container image, deploys the Worker
```
Note the deployed URL (e.g. `https://anu-web.<subdomain>.workers.dev`).

## Step 7 — Configure Stripe webhook
In the Stripe dashboard, add a webhook endpoint → `https://<deployed-url>/api/billing/webhook`,
subscribe to `checkout.session.completed`, `customer.subscription.updated`,
`customer.subscription.deleted`. Put its signing secret into `STRIPE_WEBHOOK_SECRET`
(re-run `wrangler secret put STRIPE_WEBHOOK_SECRET` if it changed) and redeploy.

## Step 8 — Smoke test the live deployment
```bash
curl -s https://<deployed-url>/api/health      # {"status":"ok","service":"anu-web"}
```
Then in a browser: register → log in → create a report for a US address. Watch it move
`queued → processing → completed` (the StatusPoller refreshes the page). Confirm the overlay
image renders and the PDF downloads. This exercises the full path: Worker → Queue →
consumer → **Container `/process`** → R2 + D1 → report viewer. (First container call has a
cold-start; subsequent calls reuse the warm instance until `sleepAfter`.)

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
- Stale-job recovery + 90-day free-tier cleanup → Cloudflare **Cron Triggers** (the old
  Docker cron scripts were deleted; rewrite as `scheduled()` handlers).
- Cross-user imagery cache.
- Custom domain (currently `*.workers.dev`).
- Password reset email (Resend) / Google OAuth (env-gated, secrets optional).
- Premium high-priority queue (currently a single `anu-reports` queue).

## Done = success criteria
- `GET /api/health` 200 on the live URL.
- A US-address report completes end-to-end with overlay + PDF.
- `reports` table on remote D1 shows a `completed` row with facets/edges and R2 object keys.
