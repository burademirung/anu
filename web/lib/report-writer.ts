import type { PrismaClient } from "@prisma/client";
import type { ContainerResult } from "@/lib/container-contract";
import { toJsonColumn } from "@/lib/json-columns";

/**
 * Persist a container result for a report: update the report row, create facet
 * rows, then create edge rows mapping the contract's facet INDICES to the new
 * facet row IDs. Marks the report completed.
 */
export async function writeReportResult(db: PrismaClient, reportId: string, result: ContainerResult): Promise<void> {
  await db.report.update({
    where: { id: reportId },
    data: {
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
    },
  });

  // Map facetIndex -> created row id so edges can resolve their FK references.
  const indexToId = new Map<number, string>();
  for (const f of result.facets) {
    const row = await db.reportFacet.create({
      data: {
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
      },
    });
    indexToId.set(f.facetIndex, row.id);
  }

  for (const e of result.edges) {
    await db.reportEdge.create({
      data: {
        reportId,
        edgeType: e.edgeType,
        lengthFt: e.lengthFt,
        geometry: toJsonColumn(e.geometry) ?? "null",
        leftFacetId: e.leftFacetIndex === null ? null : indexToId.get(e.leftFacetIndex) ?? null,
        rightFacetId: e.rightFacetIndex === null ? null : indexToId.get(e.rightFacetIndex) ?? null,
      },
    });
  }
}
