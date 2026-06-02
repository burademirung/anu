import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "@/db/schema";

let db: ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;

beforeAll(() => {
  const file = join(mkdtempSync(join(tmpdir(), "ep-")), "test.db");
  sqlite = new Database(file);
  // Apply the same DDL wrangler applies to D1.
  sqlite.exec(readFileSync(join(__dirname, "../../migrations/0001_init.sql"), "utf8"));
  db = drizzle(sqlite, { schema });
});

afterAll(() => {
  sqlite.close();
});

describe("schema round-trip on SQLite", () => {
  it("creates a user -> property -> report -> facet and reads them back", async () => {
    const [user] = await db.insert(schema.users).values({ email: "a@b.com", name: "A" }).returning();
    const [prop] = await db
      .insert(schema.properties)
      .values({ userId: user.id, addressRaw: "1 St", addressNormalized: "1 St", lat: 40.1, lon: -74.2 })
      .returning();
    const [report] = await db
      .insert(schema.reports)
      .values({ propertyId: prop.id, userId: user.id, status: "completed", roofAreaSqft: 2000.5 })
      .returning();
    await db.insert(schema.reportFacets).values({
      reportId: report.id,
      structureIndex: 0,
      facetIndex: 0,
      footprintAreaSqft: 1000,
      areaSqft: 1100,
      polygon: JSON.stringify({ type: "Polygon", coordinates: [] }),
    });

    const loaded = await db.query.reports.findFirst({
      where: eq(schema.reports.id, report.id),
      with: { facets: true, property: true },
    });
    expect(loaded).toBeDefined();
    expect(loaded!.status).toBe("completed");
    expect(loaded!.roofAreaSqft).toBeCloseTo(2000.5);
    expect(loaded!.property.lat).toBeCloseTo(40.1);
    expect(loaded!.facets).toHaveLength(1);
    expect(JSON.parse(loaded!.facets[0].polygon).type).toBe("Polygon");
  });
});
