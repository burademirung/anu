import { describe, it, expect } from "vitest";
import { createDb } from "@/lib/db";

describe("createDb", () => {
  it("is a factory that returns a Drizzle client exposing the migrated tables", () => {
    // Minimal D1-shaped stub: client construction must not touch the connection.
    const fakeD1 = {
      prepare: () => ({}),
      batch: async () => [],
      dump: async () => {},
      exec: async () => ({}),
    };
    const db = createDb(fakeD1 as never);

    // Drizzle relational query API for each migrated table.
    for (const table of ["users", "properties", "reports", "reportFacets", "reportEdges"] as const) {
      expect(db.query[table]).toBeDefined();
    }
    // Core query builders are present.
    expect(typeof db.select).toBe("function");
    expect(typeof db.insert).toBe("function");
    expect(typeof db.update).toBe("function");
    expect(typeof db.delete).toBe("function");
  });
});
