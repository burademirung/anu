import { describe, it, expect } from "vitest";
import { QuotaDO } from "@/durable-objects/quota";

function makeDO(initial = 0) {
  const mem = new Map<string, number>();
  if (initial) mem.set("count:2026-06", initial);
  const ctx = { storage: { get: async (k: string) => mem.get(k), put: async (k: string, v: number) => void mem.set(k, v) } };
  // @ts-expect-error minimal ctx for unit test
  return new QuotaDO(ctx, {} as never);
}

describe("QuotaDO", () => {
  it("grants until the limit, then denies", async () => {
    const q = makeDO(0);
    expect((await q.tryConsume("2026-06", 2)).granted).toBe(true);
    expect((await q.tryConsume("2026-06", 2)).granted).toBe(true);
    expect((await q.tryConsume("2026-06", 2)).granted).toBe(false);
  });
  it("treats null limit as unlimited", async () => {
    const q = makeDO(999);
    expect((await q.tryConsume("2026-06", null)).granted).toBe(true);
  });
  it("release frees a slot", async () => {
    const q = makeDO(2);
    expect((await q.tryConsume("2026-06", 2)).granted).toBe(false);
    await q.release("2026-06");
    expect((await q.tryConsume("2026-06", 2)).granted).toBe(true);
  });
});
