import { describe, it, expect } from "vitest";
import { createDb } from "@/lib/db";

describe("createDb", () => {
  it("is a factory that returns a Prisma client exposing the migrated models", () => {
    // Minimal D1-shaped stub: adapter construction must not touch the connection.
    const fakeD1 = { prepare: () => ({}), batch: async () => [], exec: async () => ({}) };
    const db = createDb(fakeD1 as never);
    for (const model of ["user", "property", "report", "reportFacet", "reportEdge"] as const) {
      expect(db[model]).toBeDefined();
    }
  });
});
