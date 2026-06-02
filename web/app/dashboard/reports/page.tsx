import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { reports } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { redirect } from "next/navigation";
import ReportCard from "@/components/ReportCard";

export default async function ReportsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const db = getDb();
  const reportList = await db.query.reports.findMany({
    where: eq(reports.userId, session.user.id),
    with: { property: true },
    orderBy: [desc(reports.createdAt)],
    limit: 50,
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 text-black">Reports</h1>
      {reportList.length === 0 ? (
        <p className="text-gray-500">No reports yet. <a href="/dashboard/new" className="text-blue-600 hover:underline">Create your first report</a>.</p>
      ) : (
        <div className="space-y-3">
          {reportList.map((report) => (
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
