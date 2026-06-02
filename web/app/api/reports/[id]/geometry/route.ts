import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { reports, reportFacets, reportEdges, properties } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { estimateRoofFromFootprint, ringCentroid } from "@/lib/roof-geometry";
import { writeReportResult } from "@/lib/report-writer";
import type { ContainerResult } from "@/lib/container-contract";

/**
 * Persist a user-edited roof: the footprint outline they traced/resized on the
 * map plus the pitch they set. We recompute the full facet/edge/measurement set
 * server-side (same geometry as the live preview), replace the report's facets
 * and edges, and re-center the property on the edited roof. This is the
 * authoritative source of truth for an edited report — no container/queue.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();

  const report = await db.query.reports.findFirst({
    where: and(eq(reports.id, id), eq(reports.userId, session.user.id)),
    columns: { id: true, propertyId: true },
  });
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  let body: { footprint?: number[][]; pitchRise?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ring = body.footprint;
  if (
    !Array.isArray(ring) || ring.length < 3 ||
    !ring.every((p) => Array.isArray(p) && p.length >= 2 &&
      Number.isFinite(p[0]) && Number.isFinite(p[1]) &&
      Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)
  ) {
    return NextResponse.json({ error: "Invalid footprint outline" }, { status: 400 });
  }

  const pitchRise = Math.min(Math.max(Math.round(Number(body.pitchRise) || 6), 1), 24);

  const geo = estimateRoofFromFootprint(ring, pitchRise, "manual");
  if (geo.numFacets === 0 || geo.footprintAreaSqft < 1) {
    return NextResponse.json({ error: "Outline too small to measure" }, { status: 400 });
  }

  // Clear prior facets/edges, then persist the recomputed geometry via the same
  // writer the queue consumer uses. Marks the report completed.
  await db.delete(reportEdges).where(eq(reportEdges.reportId, id));
  await db.delete(reportFacets).where(eq(reportFacets.reportId, id));

  const result: ContainerResult = {
    tier: "full",
    modelVersion: "v1.0-edited",
    roofAreaSqft: geo.roofAreaSqft,
    roofAreaSquares: geo.roofAreaSquares,
    numFacets: geo.numFacets,
    numStructures: geo.numStructures,
    wasteFactor: geo.wasteFactor,
    confidenceScore: 0.97, // user-verified outline
    pdfKey: null,
    overlayKey: null,
    imageryKey: null,
    facets: geo.facets,
    edges: geo.edges,
  };
  await writeReportResult(db, id, result);

  // Re-center the property on the edited roof so it's correctly located.
  const c = ringCentroid(ring);
  await db.update(properties).set({ lat: c.lat, lon: c.lon }).where(eq(properties.id, report.propertyId));

  return NextResponse.json({
    ok: true,
    roofAreaSqft: geo.roofAreaSqft,
    roofAreaSquares: geo.roofAreaSquares,
    numFacets: geo.numFacets,
    wasteFactor: geo.wasteFactor,
  });
}
