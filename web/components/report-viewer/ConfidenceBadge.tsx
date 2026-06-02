export default function ConfidenceBadge({ confidenceScore }: { tier?: string | null; confidenceScore: number | null }) {
  return (
    <div className="flex gap-2">
      <span className="text-xs px-3 py-1 rounded-full font-medium bg-green-100 text-green-800">
        Full Report
      </span>
      {confidenceScore !== null && (
        <span className="text-xs px-3 py-1 rounded-full bg-blue-100 text-blue-800">
          {Math.round(Number(confidenceScore) * 100)}% confidence
        </span>
      )}
    </div>
  );
}
