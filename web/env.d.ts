import type { D1Database, R2Bucket, DurableObjectId, Queue } from "@cloudflare/workers-types";
import type { RateLimiterDO } from "./durable-objects/rate-limiter";
import type { QuotaDO } from "./durable-objects/quota";
import type { AnuMLContainer } from "./containers/anu-ml";

declare global {
  type ExportedHandler<Env = unknown> = import("@cloudflare/workers-types").ExportedHandler<Env>;

  /**
   * RPC stub over a Durable Object instance: every async method of the DO is
   * callable directly on the stub (returning a Promise of its result).
   */
  type DurableObjectStub<T> = {
    [K in keyof T]: T[K] extends (...args: infer A) => infer R
      ? (...args: A) => R extends Promise<unknown> ? R : Promise<R>
      : never;
  };

  /** Typed Durable Object namespace whose stubs expose the DO instance's methods. */
  interface TypedDurableObjectNamespace<T> {
    idFromName(name: string): DurableObjectId;
    newUniqueId(): DurableObjectId;
    idFromString(id: string): DurableObjectId;
    get(id: DurableObjectId): DurableObjectStub<T>;
  }

  /**
   * Durable Object namespace as the `@cloudflare/containers` helpers expect it:
   * `getContainer(ns, name)` does `ns.get(ns.idFromName(name))` and returns a
   * stub exposing the container's `fetch`. We declare the global here (rather
   * than via `@cloudflare/workers-types`'s project-wide lib, which redefines DOM
   * globals) so `lib/queue-consumer.ts` can reference the binding type.
   */
  interface DurableObjectNamespace<T = unknown> {
    idFromName(name: string): DurableObjectId;
    newUniqueId(): DurableObjectId;
    idFromString(id: string): DurableObjectId;
    get(id: DurableObjectId): DurableObjectStub<T> & {
      fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
    };
  }

  interface CloudflareEnv {
    DB: D1Database;
    BUCKET: R2Bucket;
    RATE_LIMITER: TypedDurableObjectNamespace<RateLimiterDO>;
    QUOTA: TypedDurableObjectNamespace<QuotaDO>;
    QUEUE: Queue;
    CONTAINER: DurableObjectNamespace<AnuMLContainer>;
    // Vars/secrets used by existing code (typed for convenience):
    NEXTAUTH_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
  }
}

export {};
