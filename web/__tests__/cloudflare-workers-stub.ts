// Test-only stub for the `cloudflare:workers` runtime module, which is not
// resolvable in the node vitest environment. Provides a minimal DurableObject
// base class so Durable Object classes can be imported and unit-tested directly.
export class DurableObject {
  ctx: unknown;
  env: unknown;
  constructor(ctx: unknown, env: unknown) {
    this.ctx = ctx;
    this.env = env;
  }
}
