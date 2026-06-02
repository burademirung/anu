import { getCloudflareContext } from "@opennextjs/cloudflare";

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const { env } = getCloudflareContext();
  const id = env.RATE_LIMITER.idFromName(key);
  const stub = env.RATE_LIMITER.get(id);
  const r = await stub.hit(limit, windowSeconds);
  return { allowed: r.allowed, remaining: r.remaining, resetAt: new Date(r.resetAt) };
}
