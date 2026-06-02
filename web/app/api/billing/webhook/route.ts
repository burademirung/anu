import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { getDb } from "@/lib/db";
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
        await db.user.updateMany({
          where: { stripeCustomerId: session.customer as string },
          data: {
            plan: "premium",
            stripeSubscriptionId: session.subscription as string,
            monthlyReportLimit: null, // unlimited
          },
        });
      }
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      if (sub.customer) {
        await db.user.updateMany({
          where: { stripeCustomerId: sub.customer as string },
          data: {
            plan: "free",
            stripeSubscriptionId: null,
            monthlyReportLimit: 5,
          },
        });
      }
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      if (sub.customer && sub.status === "active") {
        await db.user.updateMany({
          where: { stripeCustomerId: sub.customer as string },
          data: { plan: "premium", monthlyReportLimit: null },
        });
      } else if (sub.customer && ["canceled", "unpaid", "past_due"].includes(sub.status)) {
        await db.user.updateMany({
          where: { stripeCustomerId: sub.customer as string },
          data: { plan: "free", monthlyReportLimit: 5 },
        });
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
