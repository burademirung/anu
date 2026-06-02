import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { reports, reportFacets } from "@/db/schema";
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
