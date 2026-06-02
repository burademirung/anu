export default function ConfidenceBadge({ tier, confidenceScore }: { tier: string | null; confidenceScore: number | null }) {
  const tierColor = tier === "full" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800";
  return (
    <div className="flex gap-2">
      <span className={`text-xs px-3 py-1 rounded-full font-medium ${tierColor}`}>
        {tier === "full" ? "Full Report" : "Basic Report"}
      </span>
      {confidenceScore !== null && (
        <span className="text-xs px-3 py-1 rounded-full bg-blue-100 text-blue-800">
          {Math.round(Number(confidenceScore) * 100)}% confidence
        </span>
      )}
    </div>
  );
}
