import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { redirect } from "next/navigation";
import ReportCard from "@/components/ReportCard";

export default async function ReportsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const db = getDb();
  const reports = await db.report.findMany({
    where: { userId: session.user.id },
    include: { property: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 text-black">Reports</h1>
      {reports.length === 0 ? (
        <p className="text-gray-500">No reports yet. <a href="/dashboard/new" className="text-blue-600 hover:underline">Create your first report</a>.</p>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <ReportCard
              key={report.id}
              id={report.id}
              status={report.status}
              tier={report.tier}
              address={report.property.addressNormalized || report.property.addressRaw}
              roofAreaSqft={report.roofAreaSqft ? Number(report.roofAreaSqft) : null}
              createdAt={report.createdAt.toISOString()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
