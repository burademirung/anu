import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "placeholder", {
      apiVersion: "2026-05-27.dahlia",
    });
  }
  return _stripe;
}

// Named export for convenience – resolves lazily at first call
export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return Reflect.get(getStripe(), prop);
  },
});
