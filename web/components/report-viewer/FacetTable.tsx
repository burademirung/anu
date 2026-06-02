interface Facet {
  id: string;
  facetIndex: number;
  structureIndex: number;
  areaSqft: number;
  pitch: string | null;
  pitchDegrees: number | null;
  pitchConfidence: string | null;
  orientation: string | null;
}

export default function FacetTable({ facets }: { facets: Facet[] }) {
  if (facets.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="text-left p-3">#</th>
            <th className="text-left p-3">Area (sq ft)</th>
            <th className="text-left p-3">Pitch</th>
            <th className="text-left p-3">Orientation</th>
            <th className="text-left p-3">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {facets.map((f) => (
            <tr key={f.id} className="border-t">
              <td className="p-3">{f.facetIndex + 1}</td>
              <td className="p-3">{Math.round(Number(f.areaSqft))}</td>
              <td className="p-3">{f.pitch || "N/A"}</td>
              <td className="p-3">{f.orientation || "N/A"}</td>
              <td className="p-3">{f.pitchConfidence || "N/A"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
