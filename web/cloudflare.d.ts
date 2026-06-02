// Ambient declaration of the `cloudflare:workers` runtime module (provides the
// Durable Object base class). This file is intentionally a SCRIPT (no top-level
// import/export) so `declare module` registers as an ambient module rather than
// a module augmentation. We avoid a project-wide
// `/// <reference types="@cloudflare/workers-types" />` because the Workers
// global lib redefines DOM globals (Request/Response/fetch) and breaks the rest
// of the Next.js app's typing; inline `import(...)` types stay isolated.

declare module "cloudflare:workers" {
  // Base class for Durable Objects. `ctx` exposes per-instance storage.
  export abstract class DurableObject<Env = unknown> {
    protected ctx: import("@cloudflare/workers-types").DurableObjectState;
    protected env: Env;
    constructor(ctx: import("@cloudflare/workers-types").DurableObjectState, env: Env);
  }
}
