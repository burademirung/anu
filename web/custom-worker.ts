// Custom Worker entrypoint for OpenNext on Cloudflare.
//
// The OpenNext adapter generates `.open-next/worker.js`, which only exports a
// fetch handler. For a `durable_objects` binding to resolve, the DO class must
// be exported from the *deployed* Worker entry. So we wrap the generated
// handler and additionally export our custom Durable Object classes here, then
// point `wrangler main` at this file.
//
// Mechanism per OpenNext docs: https://opennext.js.org/cloudflare/howtos/custom-worker

// @ts-expect-error `.open-next/worker.js` is generated at build time
import { default as handler } from "./.open-next/worker.js";
import { handleQueueBatch } from "./lib/queue-consumer";

export default {
  fetch: handler.fetch,
  queue: (batch: MessageBatch<unknown>, env: CloudflareEnv) =>
    handleQueueBatch(batch as never, env as never),
} satisfies ExportedHandler<CloudflareEnv>;

// Custom Durable Objects (bound in wrangler.jsonc).
export { RateLimiterDO } from "./durable-objects/rate-limiter";
export { QuotaDO } from "./durable-objects/quota";

// Durable-Object-backed Cloudflare Container for the ML pipeline (CONTAINER binding).
export { AnuMLContainer } from "./containers/anu-ml";
