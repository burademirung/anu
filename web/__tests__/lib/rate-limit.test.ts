import { describe, it, expect, vi } from "vitest";

const store = new Map<string, unknown>();
const fakeStub = {
  async hit(limit: number, win: number) {
    const now = Math.floor(Date.now() / 1000);
    const start = Math.floor(now / win) * win;
    const w = (store.get("w") as { start: number; count: number }) ?? { start, count: 0 };
    const cur = w.start === start ? w : { start, count: 0 };
    cur.count += 1; store.set("w", cur);
    return { allowed: cur.count <= limit, remaining: Math.max(0, limit - cur.count), resetAt: (start + win) * 1000 };
  },
};
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: { RATE_LIMITER: { idFromName: () => "id", get: () => fakeStub } } }),
}));

import { rateLimit } from "@/lib/rate-limit";

describe("rateLimit (DO-backed)", () => {
  it("allows up to the limit then blocks", async () => {
    let last = await rateLimit("k", 2, 60); // 1
    expect(last.allowed).toBe(true);
    last = await rateLimit("k", 2, 60); // 2
    expect(last.allowed).toBe(true);
    last = await rateLimit("k", 2, 60); // 3 -> over
    expect(last.allowed).toBe(false);
    expect(last.resetAt).toBeInstanceOf(Date);
  });
});
