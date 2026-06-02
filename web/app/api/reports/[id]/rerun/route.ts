import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { reports, reportFacets, reportEdges } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * Re-run an existing report: clear any prior results, reset the row to
 * `queued`, and re-enqueue the job. Lets a user regenerate a report (e.g. after
 * a transient failure) without re-entering the address.
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
