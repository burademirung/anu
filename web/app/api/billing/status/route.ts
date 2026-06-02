import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { plan: true, monthlyReportLimit: true },
  });

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const reportCount = await db.report.count({
    where: {
      userId: session.user.id,
      createdAt: { gte: startOfMonth },
      status: { not: "failed" },
    },
  });

  return NextResponse.json({ user, reportCount });
}
