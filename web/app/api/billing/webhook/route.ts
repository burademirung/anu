import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { getDb } from "@/lib/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import Stripe from "stripe";

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET || ""
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const db = getDb();
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.customer && session.subscription) {
        await db
          .update(users)
          .set({
            plan: "premium",
            stripeSubscriptionId: session.subscription as string,
            monthlyReportLimit: null, // unlimited
          })
          .where(eq(users.stripeCustomerId, session.customer as string));
      }
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      if (sub.customer) {
        await db
          .update(users)
          .set({
            plan: "free",
            stripeSubscriptionId: null,
            monthlyReportLimit: 5,
          })
          .where(eq(users.stripeCustomerId, sub.customer as string));
      }
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      if (sub.customer && sub.status === "active") {
        await db
          .update(users)
          .set({ plan: "premium", monthlyReportLimit: null })
          .where(eq(users.stripeCustomerId, sub.customer as string));
      } else if (sub.customer && ["canceled", "unpaid", "past_due"].includes(sub.status)) {
        await db
          .update(users)
          .set({ plan: "free", monthlyReportLimit: 5 })
          .where(eq(users.stripeCustomerId, sub.customer as string));
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
