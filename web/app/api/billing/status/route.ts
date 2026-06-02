import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { users, reports } from "@/db/schema";
import { eq, and, gte, ne, sql } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { plan: true, monthlyReportLimit: true },
  });

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const countRows = await db
    .select({ c: sql<number>`count(*)` })
    .from(reports)
    .where(
      and(
        eq(reports.userId, session.user.id),
        gte(reports.createdAt, startOfMonth),
        ne(reports.status, "failed"),
      ),
    );
  const reportCount = countRows[0].c;

  return NextResponse.json({ user, reportCount });
}
