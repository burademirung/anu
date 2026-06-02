import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "@/db/schema";
import { writeReportResult } from "@/lib/report-writer";
import type { Db } from "@/lib/db";
import type { ContainerResult } from "@/lib/container-contract";

let db: ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let reportId: string;

beforeAll(async () => {
  const file = join(mkdtempSync(join(tmpdir(), "anu-")), "t.db");
  sqlite = new Database(file);
  sqlite.exec(readFileSync(join(__dirname, "../../migrations/0001_init.sql"), "utf8"));
  db = drizzle(sqlite, { schema });
  const [u] = await db.insert(schema.users).values({ email: "a@b.com", name: "A" }).returning();
  const [p] = await db
    .insert(schema.properties)
    .values({ userId: u.id, addressRaw: "1", addressNormalized: "1", lat: 1, lon: 2 })
    .returning();
  const [r] = await db
    .insert(schema.reports)
    .values({ userId: u.id, propertyId: p.id, status: "processing" })
    .returning();
  reportId = r.id;
});
afterAll(() => {
  sqlite.close();
});

const result: ContainerResult = {
  tier: "full", modelVersion: "v1.0", roofAreaSqft: 2000, roofAreaSquares: 20,
  numFacets: 2, numStructures: 1, wasteFactor: 14, confidenceScore: 0.9,
  pdfKey: "reports/r/p.pdf", overlayKey: "reports/r/o.png", imageryKey: "imagery/i.png",
  facets: [
    { structureIndex: 0, facetIndex: 0, footprintAreaSqft: 1000, areaSqft: 1100, pitch: "6/12", pitchDegrees: 26.57, pitchConfidence: "measured", orientation: "S", polygon: { type: "Polygon", coordinates: [] } },
    { structureIndex: 0, facetIndex: 1, footprintAreaSqft: 900, areaSqft: 980, pitch: "6/12", pitchDegrees: 26.57, pitchConfidence: "measured", orientation: "N", polygon: { type: "Polygon", coordinates: [] } },
  ],
  edges: [{ edgeType: "ridge", lengthFt: 30, geometry: { type: "LineString", coordinates: [] }, leftFacetIndex: 0, rightFacetIndex: 1 }],
};

describe("writeReportResult", () => {
  it("writes report fields, facets, and edges with facet-index→id mapping", async () => {
    await writeReportResult(db as unknown as Db, reportId, result);
    const r = await db.query.reports.findFirst({
      where: eq(schema.reports.id, reportId),
      with: { facets: true, edges: true },
    });
    expect(r).toBeDefined();
    expect(r!.status).toBe("completed");
    expect(r!.tier).toBe("full");
    expect(r!.roofAreaSqft).toBeCloseTo(2000);
    expect(r!.pdfUrl).toBe("reports/r/p.pdf");
    expect(r!.facets).toHaveLength(2);
    expect(r!.edges).toHaveLength(1);
    const edge = r!.edges[0];
    const f0 = r!.facets.find((f) => f.facetIndex === 0)!;
    const f1 = r!.facets.find((f) => f.facetIndex === 1)!;
    expect(edge.leftFacetId).toBe(f0.id);
    expect(edge.rightFacetId).toBe(f1.id);
    expect(JSON.parse(f0.polygon).type).toBe("Polygon");
  });
});
