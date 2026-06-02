import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { users, properties, reports } from "@/db/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Rate limit: 10 req/min per IP, 30 req/min per user
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  const ipLimit = await rateLimit(`ip:${ip}`, 10, 60);
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const userLimit = await rateLimit(`user:${userId}`, 30, 60);
  if (!userLimit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const { propertyId, lat, lon, addressRaw, addressNormalized } = await req.json();

  if (!lat || !lon || !addressRaw) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Check monthly report limit for free users
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Per-user monthly quota, serialized by a Durable Object (replaces pg advisory lock).
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  let quotaStub: DurableObjectStub<import("@/durable-objects/quota").QuotaDO> | null = null;
  if (user.plan === "free") {
    const { env } = getCloudflareContext();
    const id = env.QUOTA.idFromName(userId);
    quotaStub = env.QUOTA.get(id);
    const { granted } = await quotaStub.tryConsume(month, user.monthlyReportLimit ?? 5);
    if (!granted) {
      return NextResponse.json(
        { error: "Monthly report limit reached. Upgrade to premium for unlimited reports." },
        { status: 403 }
      );
    }
  }

  // Find or create property (per-user dedup within ~50m)
  let property;
  if (propertyId) {
    property = await db.query.properties.findFirst({
      where: and(eq(properties.id, propertyId), eq(properties.userId, userId)),
    });
  }

  if (!property) {
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    const delta = 0.00045; // ~50m

    // Check for existing property at this location for this user
    property = await db.query.properties.findFirst({
      where: and(
        eq(properties.userId, userId),
        gte(properties.lat, latNum - delta),
        lte(properties.lat, latNum + delta),
        gte(properties.lon, lonNum - delta),
        lte(properties.lon, lonNum + delta),
      ),
    });

    if (!property) {
      const [created] = await db
        .insert(properties)
        .values({
          userId,
          addressRaw,
          addressNormalized: addressNormalized || addressRaw,
          lat: latNum,
          lon: lonNum,
        })
        .returning();
      property = created;
    }
  }

  // Create report
  const [report] = await db
    .insert(reports)
    .values({
      userId,
      propertyId: property.id,
      status: "queued",
    })
    .returning();

  // Enqueue the job (durable; the queue consumer processes it).
  // NOTE: premium/free queue priority (separate high-priority queue) is deferred
  // — a single queue suffices for now.
  try {
    const { env } = getCloudflareContext();
    await env.QUEUE.send({
      reportId: report.id,
      propertyId: property.id,
      lat: Number(property.lat),
      lon: Number(property.lon),
    });
  } catch {
    await db
      .update(reports)
      .set({ status: "failed", errorMessage: "Could not queue report" })
      .where(eq(reports.id, report.id));
    if (quotaStub) await quotaStub.release(month);
    return NextResponse.json(
      { error: "Could not queue report, please try again" },
      { status: 503 }
    );
  }

  return NextResponse.json({ id: report.id, status: "queued" }, { status: 201 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const rows = await db.query.reports.findMany({
    where: eq(reports.userId, session.user.id),
    with: { property: true },
    orderBy: [desc(reports.createdAt)],
    limit: 50,
  });

  return NextResponse.json(rows);
}
