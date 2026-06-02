"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export interface RoofFacet {
  polygon: string; // GeoJSON Polygon (lon/lat) as stored TEXT
  pitch?: string | null;
  orientation?: string | null;
}

// Distinct highlight colors per facet (matches the PDF overlay palette spirit).
const FACET_COLORS = ["#ff5050", "#3ec46e", "#3b82f6", "#f59e0b", "#a855f7", "#06b6d4"];

/**
 * Client-side satellite map (Esri World Imagery, no API key) that highlights the
 * roof. Renders the stored facet polygons (lon/lat GeoJSON) over the aerial
 * basemap, centered on the property. Leaflet is imported at runtime inside
 * useEffect so it never executes during SSR (it touches `window` on import).
 */
export default function RoofMap({
  lat,
  lon,
  facets,
}: {
  lat: number;
  lon: number;
  facets: RoofFacet[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import("leaflet").Map | undefined;
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;

      map = L.map(containerRef.current, {
        scrollWheelZoom: false,
        attributionControl: true,
      }).setView([lat, lon], 20);
      map.attributionControl.setPrefix(false); // drop the "Leaflet" prefix

      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 22,
          maxNativeZoom: 19,
          attribution: "&copy; Esri",
        }
      ).addTo(map);

      const allLatLngs: [number, number][] = [];

      facets.forEach((facet, i) => {
        let coords: number[][] | undefined;
        try {
          const geo = JSON.parse(facet.polygon);
          coords = geo?.coordinates?.[0];
        } catch {
          return;
        }
        if (!coords || coords.length < 3) return;

        // GeoJSON is [lon, lat]; Leaflet wants [lat, lon].
        const latlngs = coords
          .filter((c) => Array.isArray(c) && c.length >= 2)
          .map((c) => [c[1], c[0]] as [number, number]);
        if (latlngs.length < 3) return;

        const color = FACET_COLORS[i % FACET_COLORS.length];
        const poly = L.polygon(latlngs, {
          color: "#ffffff",
          weight: 2,
          fillColor: color,
          fillOpacity: 0.45,
        }).addTo(map!);

        const label = [facet.pitch, facet.orientation].filter(Boolean).join(" · ");
        if (label) poly.bindTooltip(label, { direction: "center" });

        allLatLngs.push(...latlngs);
      });

      if (allLatLngs.length > 0) {
        map.fitBounds(allLatLngs, { padding: [40, 40], maxZoom: 21 });
      }

      // Tiles can mis-size if the container animates in; nudge a recalculation.
      setTimeout(() => map?.invalidateSize(), 200);
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [lat, lon, facets]);

  return (
    <div
      ref={containerRef}
      className="w-full h-[440px] rounded-lg overflow-hidden border bg-slate-100 z-0"
    />
  );
}
