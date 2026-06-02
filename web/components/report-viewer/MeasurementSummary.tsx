interface Props {
  roofAreaSqft: number | null;
  roofAreaSquares: number | null;
  numFacets: number | null;
  numStructures: number | null;
  wasteFactor: number | null;
  confidenceScore: number | null;
  tier: string | null;
}

export default function MeasurementSummary({ roofAreaSqft, roofAreaSquares, numFacets, numStructures, wasteFactor, confidenceScore }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      <div className="p-4 bg-white rounded-lg border">
        <p className="text-sm text-gray-500">Total Roof Area</p>
        <p className="text-2xl font-bold">{roofAreaSqft ? `${Math.round(roofAreaSqft)} sq ft` : "—"}</p>
      </div>
      <div className="p-4 bg-white rounded-lg border">
        <p className="text-sm text-gray-500">Roofing Squares</p>
        <p className="text-2xl font-bold">{roofAreaSquares ? Number(roofAreaSquares).toFixed(1) : "—"}</p>
      </div>
      <div className="p-4 bg-white rounded-lg border">
        <p className="text-sm text-gray-500">Structures</p>
        <p className="text-2xl font-bold">{numStructures ?? "—"}</p>
      </div>
      <div className="p-4 bg-white rounded-lg border">
        <p className="text-sm text-gray-500">Facets</p>
        <p className="text-2xl font-bold">{numFacets ?? "—"}</p>
      </div>
      <div className="p-4 bg-white rounded-lg border">
        <p className="text-sm text-gray-500">Waste Factor</p>
        <p className="text-2xl font-bold">{wasteFactor !== null ? `${wasteFactor}%` : "—"}</p>
      </div>
      <div className="p-4 bg-white rounded-lg border">
        <p className="text-sm text-gray-500">Confidence</p>
        <p className="text-2xl font-bold">{confidenceScore !== null ? `${Math.round(Number(confidenceScore) * 100)}%` : "—"}</p>
      </div>
    </div>
  );
}
