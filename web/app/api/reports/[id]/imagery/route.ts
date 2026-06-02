import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { reports } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getObjectBytes } from "@/lib/s3";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const db = getDb();
  const report = await db.query.reports.findFirst({
    where: and(eq(reports.id, id), eq(reports.userId, session.user.id)),
    with: { property: { columns: { imageryPath: true } } },
  });

  if (!report?.property?.imageryPath) return new Response("Not found", { status: 404 });

  const bytes = await getObjectBytes(report.property.imageryPath);
  if (!bytes) return new Response("Not found", { status: 404 });

  return new Response(bytes, {
    headers: { "Content-Type": "image/png" },
  });
}
