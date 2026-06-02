import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";
import { users, properties, reports, reportFacets, reportEdges } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

const PASSWORD = "AnuDemo2026!";

type Roof = {
  addressRaw: string;
  addressNormalized: string;
  lat: number;
  lon: number;
  area: number;        // total roof sqft
  pitchDeg: number;
  pitchRise: number;   // x/12
  facets: number;
  waste: number;       // %
  confidence: number;  // 0..1
  daysAgo: number;
  tier?: "full" | "basic";
};

const ACCOUNTS: { email: string; name: string; company: string; roofs: Roof[] }[] = [
  {
    email: "demo@anu.dev",
    name: "Dana Reyes",
    company: "Summit Roofing Co.",
    roofs: [
      { addressRaw: "1600 Pennsylvania Ave NW, Washington, DC 20500", addressNormalized: "1600 Pennsylvania Ave NW, Washington, DC, 20500", lat: 38.8977, lon: -77.0365, area: 4280, pitchDeg: 26.57, pitchRise: 6, facets: 6, waste: 16, confidence: 0.93, daysAgo: 1 },
      { addressRaw: "350 Fifth Ave, New York, NY 10118", addressNormalized: "350 5th Ave, New York, NY, 10118", lat: 40.7484, lon: -73.9857, area: 3120, pitchDeg: 18.43, pitchRise: 4, facets: 4, waste: 12, confidence: 0.9, daysAgo: 3 },
      { addressRaw: "233 S Wacker Dr, Chicago, IL 60606", addressNormalized: "233 S Wacker Dr, Chicago, IL, 60606", lat: 41.8789, lon: -87.6359, area: 5640, pitchDeg: 33.69, pitchRise: 8, facets: 5, waste: 19, confidence: 0.94, daysAgo: 6 },
      { addressRaw: "1 Dr Carlton B Goodlett Pl, San Francisco, CA 94102", addressNormalized: "1 Dr Carlton B Goodlett Pl, San Francisco, CA, 94102", lat: 37.7793, lon: -122.4193, area: 2960, pitchDeg: 22.62, pitchRise: 5, facets: 4, waste: 13, confidence: 0.88, daysAgo: 9 },
      { addressRaw: "400 Broad St, Seattle, WA 98109", addressNormalized: "400 Broad St, Seattle, WA, 98109", lat: 47.6205, lon: -122.3493, area: 2240, pitchDeg: 26.57, pitchRise: 6, facets: 3, waste: 11, confidence: 0.86, daysAgo: 14 },
      { addressRaw: "2 15th St NW, Washington, DC 20024", addressNormalized: "2 15th St NW, Washington, DC, 20024", lat: 38.8895, lon: -77.0353, area: 1680, pitchDeg: 0, pitchRise: 0, facets: 1, waste: 10, confidence: 0.7, daysAgo: 20, tier: "basic" },
    ],
  },
  {
    email: "solo@anu.dev",
    name: "Marcus Bell",
    company: "Bell Exteriors",
    roofs: [
      { addressRaw: "1060 W Addison St, Chicago, IL 60613", addressNormalized: "1060 W Addison St, Chicago, IL, 60613", lat: 41.9484, lon: -87.6553, area: 3400, pitchDeg: 30.26, pitchRise: 7, facets: 5, waste: 17, confidence: 0.92, daysAgo: 2 },
      { addressRaw: "2800 E Observatory Rd, Los Angeles, CA 90027", addressNormalized: "2800 E Observatory Rd, Los Angeles, CA, 90027", lat: 34.1184, lon: -118.3004, area: 2520, pitchDeg: 22.62, pitchRise: 5, facets: 4, waste: 13, confidence: 0.89, daysAgo: 5 },
      { addressRaw: "600 Montgomery St, San Francisco, CA 94111", addressNormalized: "600 Montgomery St, San Francisco, CA, 94111", lat: 37.7952, lon: -122.4028, area: 1980, pitchDeg: 18.43, pitchRise: 4, facets: 3, waste: 11, confidence: 0.85, daysAgo: 11 },
    ],
  },
];

const ORIENT = ["S", "E", "N", "W", "SE", "NW"];

function poly() {
  return JSON.stringify({ type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 8], [0, 8], [0, 0]]] });
}
function line() {
  return JSON.stringify({ type: "LineString", coordinates: [[0, 0], [12, 0]] });
}

export async function POST(req: Request) {
  const token = req.headers.get("x-seed-token");
  if (!process.env.SEED_TOKEN || token !== process.env.SEED_TOKEN) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const db = getDb();
  const hash = await bcrypt.hash(PASSWORD, 12);
  const seeded: Record<string, number> = {};

  for (const acct of ACCOUNTS) {
    // idempotent cleanup (explicit order — don't rely on D1 cascade)
    const existing = await db.query.users.findFirst({ where: eq(users.email, acct.email) });
    if (existing) {
      const reps = await db.query.reports.findMany({
        where: eq(reports.userId, existing.id),
        columns: { id: true },
      });
      const ids = reps.map((r) => r.id);
      if (ids.length) {
        await db.delete(reportEdges).where(inArray(reportEdges.reportId, ids));
        await db.delete(reportFacets).where(inArray(reportFacets.reportId, ids));
        await db.delete(reports).where(inArray(reports.id, ids));
      }
      await db.delete(properties).where(eq(properties.userId, existing.id));
      await db.delete(users).where(eq(users.id, existing.id));
    }

    const [user] = await db
      .insert(users)
      .values({
        email: acct.email,
        name: acct.name,
        companyName: acct.company,
        passwordHash: hash,
        plan: "free",
        monthlyReportLimit: null, // unlimited — the product is free for everyone
      })
      .returning();

    let count = 0;
    for (const r of acct.roofs) {
      const created = new Date(Date.now() - r.daysAgo * 86_400_000);
      const tier = r.tier ?? "full";
      const [property] = await db
        .insert(properties)
        .values({
          userId: user.id,
          addressRaw: r.addressRaw,
          addressNormalized: r.addressNormalized,
          lat: r.lat,
          lon: r.lon,
          imagerySource: "naip",
          lidarAvailable: tier === "full",
          createdAt: created,
        })
        .returning();
      const [report] = await db
        .insert(reports)
        .values({
          userId: user.id,
          propertyId: property.id,
          status: "completed",
          tier,
          modelVersion: "v1.0",
          roofAreaSqft: r.area,
          roofAreaSquares: Math.round((r.area / 100) * 10) / 10,
          numFacets: r.facets,
          numStructures: 1,
          wasteFactor: r.waste,
          confidenceScore: r.confidence,
          processingStartedAt: created,
          processingCompletedAt: created,
          createdAt: created,
        })
        .returning();

      const facetIds: string[] = [];
      const per = r.area / r.facets;
      const cosp = Math.max(Math.cos((r.pitchDeg * Math.PI) / 180), 0.5);
      for (let i = 0; i < r.facets; i++) {
        const [f] = await db
          .insert(reportFacets)
          .values({
            reportId: report.id,
            structureIndex: 0,
            facetIndex: i,
            footprintAreaSqft: Math.round(per),
            areaSqft: Math.round(per / cosp),
            pitch: tier === "full" ? `${r.pitchRise}/12` : null,
            pitchDegrees: tier === "full" ? r.pitchDeg : null,
            pitchConfidence: tier === "full" ? "measured" : null,
            orientation: tier === "full" ? ORIENT[i % ORIENT.length] : null,
            polygon: poly(),
            createdAt: created,
          })
          .returning();
        facetIds.push(f.id);
      }

      if (tier === "full") {
        const s = Math.sqrt(r.area);
        const edges: [string, number][] = [
          ["ridge", Math.round(s * 0.6)],
          ["hip", Math.round(s * 0.5)],
          ["hip", Math.round(s * 0.5)],
          ["valley", Math.round(s * 0.3)],
          ["eave", Math.round(s * 0.9)],
          ["eave", Math.round(s * 0.9)],
          ["rake", Math.round(s * 0.4)],
        ];
        for (const [edgeType, lengthFt] of edges) {
          await db.insert(reportEdges).values({
            reportId: report.id,
            edgeType,
            lengthFt,
            geometry: line(),
            leftFacetId: facetIds[0] ?? null,
            rightFacetId: facetIds[1] ?? null,
          });
        }
      }
      count++;
    }
    seeded[acct.email] = count;
  }

  return NextResponse.json({ ok: true, seeded, password: PASSWORD });
}
