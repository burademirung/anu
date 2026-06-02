import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { address } = await req.json();
  if (!address) {
    return NextResponse.json({ error: "Address is required" }, { status: 400 });
  }

  // US Census Bureau Geocoder — free, no API key, US addresses only.
  // Fits the product (NAIP + 3DEP are US-only datasets).
  const url =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress" +
    `?address=${encodeURIComponent(address)}` +
    "&benchmark=Public_AR_Current&format=json";

  let data: { result?: { addressMatches?: Array<{ matchedAddress?: string; coordinates?: { x: number; y: number } }> } };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      return NextResponse.json({ error: "Geocoding failed" }, { status: 502 });
    }
    data = await res.json();
  } catch {
    return NextResponse.json({ error: "Geocoding failed" }, { status: 502 });
  }

  const match = data.result?.addressMatches?.[0];
  const lat = match?.coordinates?.y;
  const lon = match?.coordinates?.x;
  if (typeof lat !== "number" || typeof lon !== "number") {
    return NextResponse.json({ error: "Address not found" }, { status: 404 });
  }

  return NextResponse.json({
    lat,
    lon,
    addressNormalized: match?.matchedAddress || address,
  });
}
