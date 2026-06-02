import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getObjectBytes } from "@/lib/s3";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const db = getDb();
  const report = await db.report.findFirst({
    where: { id, userId: session.user.id },
    select: { overlayUrl: true },
  });

  if (!report?.overlayUrl) return new Response("Not found", { status: 404 });

  const bytes = await getObjectBytes(report.overlayUrl);
  if (!bytes) return new Response("Not found", { status: 404 });

  return new Response(bytes, {
    headers: { "Content-Type": "image/png" },
  });
}
