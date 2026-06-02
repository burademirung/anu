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

  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Geocoding service not configured" }, { status: 500 });
  }

  const encoded = encodeURIComponent(address);
  const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encoded}&country=us&types=address&limit=1&access_token=${token}`;

  const res = await fetch(url);
  if (!res.ok) {
    return NextResponse.json({ error: "Geocoding failed" }, { status: 502 });
  }

  const data = await res.json();
  const features = data.features || [];

  if (features.length === 0) {
    return NextResponse.json({ error: "Address not found" }, { status: 404 });
  }

  const feature = features[0];
  const [lon, lat] = feature.geometry.coordinates;

  return NextResponse.json({
    lat,
    lon,
    addressNormalized: feature.properties?.full_address || address,
  });
}
