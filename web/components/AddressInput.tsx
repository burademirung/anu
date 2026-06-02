"use client";
import { useState } from "react";

interface AddressInputProps {
  onSubmit: (data: { lat: number; lon: number; addressRaw: string; addressNormalized: string }) => void;
  loading?: boolean;
}

export default function AddressInput({ onSubmit, loading }: AddressInputProps) {
  const [address, setAddress] = useState("");
  const [geocoded, setGeocoded] = useState<{ lat: number; lon: number; addressNormalized: string } | null>(null);
  const [error, setError] = useState("");
  const [geocoding, setGeocoding] = useState(false);

  async function handleGeocode() {
    if (!address.trim()) return;
    setGeocoding(true);
    setError("");
    setGeocoded(null);

    const res = await fetch("/api/properties/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });

    setGeocoding(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Geocoding failed");
      return;
    }

    const data = await res.json();
    setGeocoded(data);
  }

  function handleSubmit() {
    if (!geocoded) return;
    onSubmit({
      lat: geocoded.lat,
      lon: geocoded.lon,
      addressRaw: address,
      addressNormalized: geocoded.addressNormalized,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleGeocode()}
          placeholder="Enter a US property address..."
          className="flex-1 px-4 py-2 border rounded-md"
        />
        <button
          onClick={handleGeocode}
          disabled={geocoding || !address.trim()}
          className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50"
        >
          {geocoding ? "Looking up..." : "Look up"}
        </button>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {geocoded && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-md">
          <p className="font-medium">{geocoded.addressNormalized}</p>
          <p className="text-sm text-gray-500">
            {geocoded.lat.toFixed(6)}, {geocoded.lon.toFixed(6)}
          </p>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="mt-3 px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Creating report..." : "Generate Report"}
          </button>
        </div>
      )}
    </div>
  );
}
