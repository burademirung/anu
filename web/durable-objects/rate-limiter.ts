import { DurableObject } from "cloudflare:workers";

/** Fixed-window rate limiter. One instance per limiter key (e.g. ip:1.2.3.4). */
export class RateLimiterDO extends DurableObject {
  async hit(limit: number, windowSeconds: number): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
    const stored = (await this.ctx.storage.get<{ start: number; count: number }>("w")) ?? { start: 0, count: 0 };
    const w = stored.start === windowStart ? stored : { start: windowStart, count: 0 };
    w.count += 1;
    await this.ctx.storage.put("w", w);
    return {
      allowed: w.count <= limit,
      remaining: Math.max(0, limit - w.count),
      resetAt: (windowStart + windowSeconds) * 1000,
    };
  }
}
