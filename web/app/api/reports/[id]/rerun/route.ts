import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { reports, reportFacets, reportEdges, properties } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Re-run an existing report: clear any prior results, reset the row to
 * `queued`, and re-enqueue the job. Lets a user regenerate a report (e.g. after
 * a transient failure) without re-entering the address.
 *
 * Optional JSON body `{ lat, lon }` corrects the property location — used when
 * the geocoded point landed on the wrong building and the user clicks the
 * correct rooftop on the map. The pipeline then measures the building at the
 * corrected point.
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
    with: { property: true },
  });
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  // Optional corrected location (user clicked the right roof on the map).
  let override: { lat: number; lon: number } | null = null;
  try {
    const body = await req.json();
    const lat = Number(body?.lat);
    const lon = Number(body?.lon);
    if (
      Number.isFinite(lat) && Number.isFinite(lon) &&
      lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
    ) {
      override = { lat, lon };
    }
  } catch {
    // No/invalid body — a plain re-run at the existing location.
  }

  if (override) {
    await db
      .update(properties)
      .set({ lat: override.lat, lon: override.lon })
      .where(eq(properties.id, report.propertyId));
  }

  // Clear prior results so reprocessing doesn't duplicate facets/edges.
  await db.delete(reportEdges).where(eq(reportEdges.reportId, id));
  await db.delete(reportFacets).where(eq(reportFacets.reportId, id));
  await db
    .update(reports)
    .set({
      status: "queued",
      tier: null,
      roofAreaSqft: null,
      roofAreaSquares: null,
      numFacets: null,
      numStructures: null,
      wasteFactor: null,
      confidenceScore: null,
      pdfUrl: null,
      overlayUrl: null,
      errorMessage: null,
      processingStartedAt: null,
      processingCompletedAt: null,
    })
    .where(eq(reports.id, id));

  try {
    const { env } = getCloudflareContext();
    await env.QUEUE.send({
      reportId: report.id,
      propertyId: report.propertyId,
      lat: Number(report.property.lat),
      lon: Number(report.property.lon),
    });
  } catch {
    await db
      .update(reports)
      .set({ status: "failed", errorMessage: "Could not queue report" })
      .where(eq(reports.id, id));
    return NextResponse.json(
      { error: "Could not queue report, please try again" },
      { status: 503 }
    );
  }

  return NextResponse.json({ id: report.id, status: "queued" });
}
