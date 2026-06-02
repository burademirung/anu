"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AddressInput from "@/components/AddressInput";

export default function NewReportPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(data: { lat: number; lon: number; addressRaw: string; addressNormalized: string }) {
    setLoading(true);
    setError("");

    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    setLoading(false);
    if (!res.ok) {
      const result = await res.json();
      setError(result.error || "Failed to create report");
      return;
    }

    const { id } = await res.json();
    router.push(`/dashboard/reports/${id}`);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">New Roof Report</h1>
      <p className="text-gray-600 mb-6">
        Enter a US property address to generate a roof measurement report.
      </p>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      <AddressInput onSubmit={handleSubmit} loading={loading} />
    </div>
  );
}
