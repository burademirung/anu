import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { reports, reportFacets } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { redirect, notFound } from "next/navigation";
import MeasurementSummary from "@/components/report-viewer/MeasurementSummary";
import FacetTable from "@/components/report-viewer/FacetTable";
import ConfidenceBadge from "@/components/report-viewer/ConfidenceBadge";
import StatusPoller from "@/components/report-viewer/StatusPoller";

export default async function ReportViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

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

  if (!report) notFound();

  const isProcessing = report.status === "queued" || report.status === "processing";

  return (
    <div className="max-w-4xl">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-black">{report.property.addressNormalized || report.property.addressRaw}</h1>
          {report.property.imageryCaptureDate && (
            <p className="text-sm text-gray-500 mt-1">
              Based on imagery from {new Date(report.property.imageryCaptureDate).toLocaleDateString()}
            </p>
          )}
        </div>
        <ConfidenceBadge tier={report.tier} confidenceScore={report.confidenceScore ? Number(report.confidenceScore) : null} />
      </div>

      {isProcessing && (
        <div className="p-6 bg-blue-50 border border-blue-200 rounded-lg mb-6">
          <p className="text-blue-800 font-medium">Processing your report...</p>
          <p className="text-blue-600 text-sm mt-1">This typically takes 60-90 seconds. The page will update automatically.</p>
          <StatusPoller reportId={report.id} initialStatus={report.status} />
        </div>
      )}

      {report.status === "failed" && (
        <div className="p-6 bg-red-50 border border-red-200 rounded-lg mb-6">
          <p className="text-red-800 font-medium">Report generation failed</p>
          {report.errorMessage && <p className="text-red-600 text-sm mt-1">{report.errorMessage}</p>}
        </div>
      )}

      {report.status === "completed" && (
        <>
          {report.overlayUrl && (
            <div className="mb-6 rounded-lg overflow-hidden border">
              {/* Overlay is a dynamically generated PNG streamed from an auth'd API
                  route with no fixed intrinsic size; next/image optimization adds no
                  value here and complicates sizing. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/reports/${report.id}/overlay`}
                alt="Roof overlay on aerial imagery"
                className="w-full"
              />
            </div>
          )}

          <MeasurementSummary
            roofAreaSqft={report.roofAreaSqft ? Number(report.roofAreaSqft) : null}
            roofAreaSquares={report.roofAreaSquares ? Number(report.roofAreaSquares) : null}
            numFacets={report.numFacets}
            numStructures={report.numStructures}
            wasteFactor={report.wasteFactor ? Number(report.wasteFactor) : null}
            confidenceScore={report.confidenceScore ? Number(report.confidenceScore) : null}
            tier={report.tier}
          />

          {report.facets.length > 0 && (
            <div className="mt-6">
              <h2 className="text-lg font-semibold mb-3">Facet Details</h2>
              <FacetTable facets={report.facets.map(f => ({
                ...f,
                areaSqft: Number(f.areaSqft),
                pitchDegrees: f.pitchDegrees ? Number(f.pitchDegrees) : null,
              }))} />
            </div>
          )}

          {report.edges.length > 0 && (
            <div className="mt-6">
              <h2 className="text-lg font-semibold mb-3">Edge Summary</h2>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                {["ridge", "hip", "valley", "rake", "eave"].map(type => {
                  const edges = report.edges.filter(e => e.edgeType === type);
                  const totalFt = edges.reduce((sum, e) => sum + Number(e.lengthFt), 0);
                  return (
                    <div key={type} className="p-3 bg-white rounded-lg border text-center">
                      <p className="text-xs text-gray-500 capitalize">{type}</p>
                      <p className="font-bold">{totalFt > 0 ? `${Math.round(totalFt)} ft` : "—"}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-6 flex gap-3">
            {report.pdfUrl && (
              <a href={`/api/reports/${report.id}/pdf`} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                Download PDF
              </a>
            )}
          </div>

          <p className="mt-8 text-xs text-gray-400">
            Report generated with model {report.modelVersion} on {report.createdAt.toLocaleDateString()}
          </p>
        </>
      )}
    </div>
  );
}
