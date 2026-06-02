import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { getDb } from "@/lib/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { priceId } = await req.json();
  const targetPriceId = priceId || process.env.STRIPE_PRICE_MONTHLY;

  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.id, session.user.id) });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Create or retrieve Stripe customer
  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { userId: user.id },
    });
    customerId = customer.id;
    await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, user.id));
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: targetPriceId, quantity: 1 }],
    success_url: `${process.env.NEXTAUTH_URL}/dashboard/settings/billing?success=true`,
    cancel_url: `${process.env.NEXTAUTH_URL}/dashboard/settings/billing?canceled=true`,
  });

  return NextResponse.json({ url: checkoutSession.url });
}
