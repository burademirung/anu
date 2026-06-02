import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { reports, reportFacets, reportEdges } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";

export async function GET(
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
    with: {
      property: true,
      facets: { orderBy: [asc(reportFacets.structureIndex), asc(reportFacets.facetIndex)] },
      edges: true,
    },
  });

  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  return NextResponse.json(report);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();

  // Verify ownership before deleting anything.
  const report = await db.query.reports.findFirst({
    where: and(eq(reports.id, id), eq(reports.userId, session.user.id)),
    columns: { id: true },
  });
  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  // Remove child rows first (no FK cascade on D1), then the report.
  await db.delete(reportEdges).where(eq(reportEdges.reportId, id));
  await db.delete(reportFacets).where(eq(reportFacets.reportId, id));
  await db.delete(reports).where(eq(reports.id, id));

  return NextResponse.json({ deleted: true });
}
