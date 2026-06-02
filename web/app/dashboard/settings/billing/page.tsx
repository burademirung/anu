"use client";
import { useState, useEffect } from "react";
import UsageBar from "@/components/UsageBar";

export default function BillingPage() {
  const [user, setUser] = useState<{ plan: string; monthlyReportLimit: number | null } | null>(null);
  const [reportCount, setReportCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/billing/status").then(r => r.json()).then(data => {
      setUser(data.user);
      setReportCount(data.reportCount);
    });
  }, []);

  async function handleCheckout(priceId?: string) {
    setLoading(true);
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priceId }),
    });
    const { url } = await res.json();
    if (url) window.location.href = url;
    setLoading(false);
  }

  async function handlePortal() {
    const res = await fetch("/api/billing/portal", { method: "POST" });
    const { url } = await res.json();
    if (url) window.location.href = url;
  }

  if (!user) return <p>Loading...</p>;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Billing</h1>
      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="font-semibold mb-3">Usage</h2>
        <UsageBar used={reportCount} limit={user.monthlyReportLimit} />
      </div>

      {user.plan === "free" ? (
        <div className="bg-white rounded-lg border p-6">
          <h2 className="font-semibold mb-3">Upgrade to Premium</h2>
          <p className="text-gray-600 mb-4">Unlimited reports, priority processing, unlimited history.</p>
          <div className="flex gap-3">
            <button onClick={() => handleCheckout()} disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">
              $49/month
            </button>
            <button onClick={() => handleCheckout(process.env.NEXT_PUBLIC_STRIPE_PRICE_YEARLY)} disabled={loading}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50">
              $399/year (save 32%)
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg border p-6">
          <h2 className="font-semibold mb-3">Premium Plan</h2>
          <p className="text-gray-600 mb-4">You have unlimited reports.</p>
          <button onClick={handlePortal} className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700">
            Manage subscription
          </button>
        </div>
      )}
    </div>
  );
}
