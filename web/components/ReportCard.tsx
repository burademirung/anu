import Link from "next/link";

interface ReportCardProps {
  id: string;
  status: string;
  tier: string | null;
  address: string;
  roofAreaSqft: number | null;
  createdAt: string;
}

export default function ReportCard({ id, status, tier, address, roofAreaSqft, createdAt }: ReportCardProps) {
  const statusColors: Record<string, string> = {
    queued: "bg-yellow-100 text-yellow-800",
    processing: "bg-blue-100 text-blue-800",
    completed: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
  };

  return (
    <Link href={`/dashboard/reports/${id}`} className="block p-4 bg-white border rounded-lg hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-2">
        <h3 className="font-medium truncate text-black">{address}</h3>
        <span className={`text-xs px-2 py-1 rounded-full ${statusColors[status] || "bg-gray-100"}`}>
          {status}
        </span>
      </div>
      <div className="flex gap-4 text-sm text-gray-500">
        {tier && <span className="uppercase">{tier}</span>}
        {roofAreaSqft && <span>{Math.round(roofAreaSqft)} sq ft</span>}
        <span>{new Date(createdAt).toLocaleDateString()}</span>
      </div>
    </Link>
  );
}
