import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const db = getDb();
  const { id } = await params;
  const report = await db.report.findFirst({
    where: { id, userId: session.user.id },
    select: { status: true, tier: true, errorMessage: true },
  });
  if (!report) return Response.json({ error: "Report not found" }, { status: 404 });
  return Response.json({ status: report.status, tier: report.tier, error: report.errorMessage });
}
