import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; facetId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, facetId } = await params;
  const { pitchDegrees } = await req.json();

  if (pitchDegrees === undefined || pitchDegrees < 0 || pitchDegrees > 75) {
    return NextResponse.json({ error: "pitchDegrees must be between 0 and 75" }, { status: 400 });
  }

  // Verify ownership
  const db = getDb();
  const report = await db.report.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  const facet = await db.reportFacet.findFirst({
    where: { id: facetId, reportId: id },
  });
  if (!facet) return NextResponse.json({ error: "Facet not found" }, { status: 404 });

  // Calculate pitch string and surface area
  const rise = Math.round(Math.tan((pitchDegrees * Math.PI) / 180) * 12);
  const pitch = `${rise}/12`;
  const areaSqft = Number(facet.footprintAreaSqft) / Math.cos((pitchDegrees * Math.PI) / 180);

  // Update facet
  await db.reportFacet.update({
    where: { id: facetId },
    data: {
      pitch,
      pitchDegrees,
      pitchConfidence: "user_provided",
      areaSqft,
    },
  });

  // Recalculate report totals
  const allFacets = await db.reportFacet.findMany({ where: { reportId: id } });
  const totalArea = allFacets.reduce((sum, f) => sum + Number(f.areaSqft), 0);

  // Recalculate waste factor if all facets have pitch
  const allHavePitch = allFacets.every(f => f.pitchDegrees !== null);
  let wasteFactor = null;

  if (allHavePitch) {
    const edges = await db.reportEdge.findMany({ where: { reportId: id } });
    const numHips = edges.filter(e => e.edgeType === "hip").length;
    const numValleys = edges.filter(e => e.edgeType === "valley").length;
    const maxPitch = Math.max(...allFacets.map(f => Number(f.pitchDegrees || 0)));

    wasteFactor = 10;
    wasteFactor += numValleys * 2;
    wasteFactor += numHips * 1;
    if (maxPitch > 33.69) wasteFactor += 3;
    if (allFacets.length > 6) wasteFactor += 2;
    wasteFactor = Math.min(wasteFactor, 25);
  }

  await db.report.update({
    where: { id },
    data: {
      roofAreaSqft: totalArea,
      roofAreaSquares: totalArea / 100,
      wasteFactor,
    },
  });

  return NextResponse.json({ success: true, pitch, areaSqft: Math.round(areaSqft) });
}
