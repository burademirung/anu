import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

let db: PrismaClient;
let sqlite: Database.Database;

beforeAll(() => {
  const file = join(mkdtempSync(join(tmpdir(), "ep-")), "test.db");
  sqlite = new Database(file);
  // Apply the same DDL wrangler applies to D1.
  sqlite.exec(readFileSync(join(__dirname, "../../migrations/0001_init.sql"), "utf8"));
  db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) });
});

afterAll(async () => {
  await db.$disconnect();
  sqlite.close();
});

describe("schema round-trip on SQLite", () => {
  it("creates a user -> property -> report -> facet and reads them back", async () => {
    const user = await db.user.create({ data: { email: "a@b.com", name: "A" } });
    const prop = await db.property.create({
      data: { userId: user.id, addressRaw: "1 St", addressNormalized: "1 St", lat: 40.1, lon: -74.2 },
    });
    const report = await db.report.create({
      data: { propertyId: prop.id, userId: user.id, status: "completed", roofAreaSqft: 2000.5 },
    });
    await db.reportFacet.create({
      data: {
        reportId: report.id, structureIndex: 0, facetIndex: 0,
        footprintAreaSqft: 1000, areaSqft: 1100,
        polygon: JSON.stringify({ type: "Polygon", coordinates: [] }),
      },
    });

    const loaded = await db.report.findUniqueOrThrow({
      where: { id: report.id },
      include: { facets: true, property: true },
    });
    expect(loaded.status).toBe("completed");
    expect(loaded.roofAreaSqft).toBeCloseTo(2000.5);
    expect(loaded.property.lat).toBeCloseTo(40.1);
    expect(loaded.facets).toHaveLength(1);
    expect(JSON.parse(loaded.facets[0].polygon).type).toBe("Polygon");
  });
});
