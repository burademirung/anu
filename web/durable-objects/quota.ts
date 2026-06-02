import { DurableObject } from "cloudflare:workers";

/** One instance per user. Serializes monthly report-quota checks. */
export class QuotaDO extends DurableObject {
  /** Try to consume one report slot for the given month. limit=null means unlimited. */
  async tryConsume(month: string, limit: number | null): Promise<{ granted: boolean; used: number }> {
    if (limit === null) return { granted: true, used: 0 };
    const key = `count:${month}`;
    const used = (await this.ctx.storage.get<number>(key)) ?? 0;
    if (used >= limit) return { granted: false, used };
    await this.ctx.storage.put(key, used + 1);
    return { granted: true, used: used + 1 };
  }

  /** Release a previously-consumed slot (e.g. if report creation later fails). */
  async release(month: string): Promise<void> {
    const key = `count:${month}`;
    const used = (await this.ctx.storage.get<number>(key)) ?? 0;
    if (used > 0) await this.ctx.storage.put(key, used - 1);
  }
}
