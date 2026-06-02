import type { Db } from "@/lib/db";
import { reports, reportFacets, reportEdges } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ContainerResult } from "@/lib/container-contract";
import { toJsonColumn } from "@/lib/json-columns";

/**
 * Persist a container result for a report: update the report row, create facet
 * rows, then create edge rows mapping the contract's facet INDICES to the new
 * facet row IDs. Marks the report completed.
 */
export async function writeReportResult(db: Db, reportId: string, result: ContainerResult): Promise<void> {
  await db
    .update(reports)
    .set({
      status: "completed",
      tier: result.tier,
      modelVersion: result.modelVersion,
      roofAreaSqft: result.roofAreaSqft,
      roofAreaSquares: result.roofAreaSquares,
      numFacets: result.numFacets,
      numStructures: result.numStructures,
      wasteFactor: result.wasteFactor,
      confidenceScore: result.confidenceScore,
      pdfUrl: result.pdfKey,
      overlayUrl: result.overlayKey,
      processingCompletedAt: new Date(),
    })
    .where(eq(reports.id, reportId));

  // Map facetIndex -> created row id so edges can resolve their FK references.
  const indexToId = new Map<number, string>();
  for (const f of result.facets) {
    const [row] = await db
      .insert(reportFacets)
      .values({
        reportId,
        structureIndex: f.structureIndex,
        facetIndex: f.facetIndex,
        footprintAreaSqft: f.footprintAreaSqft,
        areaSqft: f.areaSqft,
        pitch: f.pitch,
        pitchDegrees: f.pitchDegrees,
        pitchConfidence: f.pitchConfidence,
        orientation: f.orientation,
        polygon: toJsonColumn(f.polygon) ?? "null",
      })
      .returning();
    indexToId.set(f.facetIndex, row.id);
  }

  for (const e of result.edges) {
    await db.insert(reportEdges).values({
      reportId,
      edgeType: e.edgeType,
      lengthFt: e.lengthFt,
      geometry: toJsonColumn(e.geometry) ?? "null",
      leftFacetId: e.leftFacetIndex === null ? null : indexToId.get(e.leftFacetIndex) ?? null,
      rightFacetId: e.rightFacetIndex === null ? null : indexToId.get(e.rightFacetIndex) ?? null,
    });
  }
}
