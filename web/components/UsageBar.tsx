interface Props {
  used: number;
  limit: number | null;
}

export default function UsageBar({ used, limit }: Props) {
  if (limit === null) {
    return <p className="text-sm text-gray-500">{used} reports this month (unlimited)</p>;
  }
  const pct = Math.min(100, (used / limit) * 100);
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span>{used} of {limit} reports used</span>
        <span>{limit - used} remaining</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div className={`h-2 rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-yellow-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
