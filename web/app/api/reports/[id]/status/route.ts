import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { reports } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const db = getDb();
  const { id } = await params;
  const report = await db.query.reports.findFirst({
    where: and(eq(reports.id, id), eq(reports.userId, session.user.id)),
    columns: { status: true, tier: true, errorMessage: true },
  });
  if (!report) return Response.json({ error: "Report not found" }, { status: 404 });
  return Response.json({ status: report.status, tier: report.tier, error: report.errorMessage });
}
