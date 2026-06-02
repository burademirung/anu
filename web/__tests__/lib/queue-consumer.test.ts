/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import { handleQueueBatch } from "@/lib/queue-consumer";

function fakeEnv(containerResult: unknown, ok = true) {
  const updates: any[] = [];

  // Chainable Drizzle-shaped fake. `update(table).set(data).where(cond)` resolves
  // to a thenable so it can be awaited and `.catch()`-ed; we record each `set` payload.
  const db = {
    update: vi.fn(() => ({
      set: vi.fn((data: any) => {
        updates.push(data);
        return {
          where: vi.fn(() => {
            const p: any = Promise.resolve({});
            return p;
          }),
        };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: "row" }]),
        then: (res: any) => Promise.resolve([]).then(res),
      })),
    })),
  };

  const env = {
    DB: {},
    CONTAINER: { fetch: vi.fn(async () => new Response(JSON.stringify(containerResult), { status: ok ? 200 : 500 })) },
  };
  return { env, db, updates };
}

const result = {
  tier: "basic", modelVersion: "v1.0", roofAreaSqft: 1000, roofAreaSquares: 10,
  numFacets: 1, numStructures: 1, wasteFactor: null, confidenceScore: 0.7,
  pdfKey: "p", overlayKey: "o", imageryKey: "i", facets: [], edges: [],
};

describe("handleQueueBatch", () => {
  it("marks processing then completed and acks on success", async () => {
    const { env, db, updates } = fakeEnv(result);
    const msg = { body: { reportId: "r1", propertyId: "p1", lat: 1, lon: 2 }, ack: vi.fn(), retry: vi.fn() };
    await handleQueueBatch({ messages: [msg] } as any, env as any, () => db as any);
    expect(updates[0].status).toBe("processing");
    expect(updates.some((u) => u.status === "completed")).toBe(true);
    expect(msg.ack).toHaveBeenCalled();
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("marks failed and retries on container error", async () => {
    const { env, db, updates } = fakeEnv(result, false);
    const msg = { body: { reportId: "r1", propertyId: "p1", lat: 1, lon: 2 }, ack: vi.fn(), retry: vi.fn() };
    await handleQueueBatch({ messages: [msg] } as any, env as any, () => db as any);
    expect(updates.some((u) => u.status === "failed")).toBe(true);
    expect(msg.retry).toHaveBeenCalled();
  });
});
