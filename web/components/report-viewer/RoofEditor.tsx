"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import type { Map as LMap, Polygon as LPolygon, LatLng } from "leaflet";
import { estimateRoofFromFootprint, convexHullRing } from "@/lib/roof-geometry";

export interface EditorFacet {
  polygon: string; // GeoJSON Polygon (lon/lat) as stored TEXT
  pitch?: string | null;
  orientation?: string | null;
}

const FACET_COLORS = ["#ff5050", "#3ec46e", "#3b82f6", "#f59e0b", "#a855f7", "#06b6d4"];
const EDIT_COLOR = "#2563eb";

function parsePitchRise(pitch?: string | null): number {
  const m = pitch?.match(/^(\d+)\s*\/\s*12$/);
  return m ? Math.min(Math.max(parseInt(m[1], 10), 1), 24) : 6;
}

/**
 * Interactive satellite roof viewer + editor.
 *
 * View mode highlights the measured facets over Esri imagery. Edit mode turns
 * the roof into a single editable outline: drag the whole shape onto the
 * correct house, drag corners to fit the roof, click an edge to add a corner,
 * right-click a corner to remove it. Area / squares update live as you edit and
 * as you set the pitch. Saving recomputes the full report from the new outline.
 */
export default function RoofEditor({
  reportId,
  lat,
  lon,
  facets,
}: {
  reportId: string;
  lat: number;
  lon: number;
  facets: EditorFacet[];
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  // Imperative map state lives in refs so React re-renders never rebuild the map.
  const LRef = useRef<typeof import("leaflet") | null>(null);
  const mapRef = useRef<LMap | null>(null);
  const facetLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const editLayerRef = useRef<LPolygon | null>(null);

  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [pitchRise, setPitchRise] = useState(() => parsePitchRise(facets[0]?.pitch));
  const [live, setLive] = useState({ footprint: 0, surface: 0, squares: 0 });
  const [saving, setSaving] = useState(false);
  // Latest pitch, mirrored for the (stable) map event handler.
  const pitchRiseRef = useRef(pitchRise);

  const facetRings = useCallback((): number[][][] => {
    const rings: number[][][] = [];
    for (const f of facets) {
      try {
        const g = JSON.parse(f.polygon);
        const ring = g?.coordinates?.[0];
        if (Array.isArray(ring) && ring.length >= 3) rings.push(ring);
      } catch {
        /* skip */
      }
    }
    return rings;
  }, [facets]);

  const getRing = useCallback((): number[][] => {
    const layer = editLayerRef.current;
    if (!layer) return [];
    const latlngs = (layer.getLatLngs() as LatLng[][])[0];
    return latlngs.map((ll) => [ll.lng, ll.lat]);
  }, []);

  const recompute = useCallback(
    (ring: number[][], rise: number) => {
      const r = estimateRoofFromFootprint(ring, rise);
      setLive({ footprint: r.footprintAreaSqft, surface: r.roofAreaSqft, squares: r.roofAreaSquares });
    },
    []
  );

  const handlePitch = useCallback(
    (v: number) => {
      pitchRiseRef.current = v;
      setPitchRise(v);
      if (editLayerRef.current) recompute(getRing(), v);
    },
    [recompute, getRing]
  );

  // ---- Create the map once ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      await import("@geoman-io/leaflet-geoman-free");
      if (cancelled || !containerRef.current || mapRef.current) return;

      LRef.current = L;
      const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView([lat, lon], 20);
      map.attributionControl.setPrefix(false);
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 22, maxNativeZoom: 19, attribution: "&copy; Esri" }
      ).addTo(map);
      mapRef.current = map;

      drawFacets();
      setReady(true);
      setTimeout(() => map.invalidateSize(), 150);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function drawFacets() {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    if (editLayerRef.current) {
      map.removeLayer(editLayerRef.current);
      editLayerRef.current = null;
    }
    facetLayerRef.current?.remove();

    const group = L.layerGroup().addTo(map);
    const bounds: [number, number][] = [];
    facetRings().forEach((ring, i) => {
      const latlngs = ring
        .filter((c) => Array.isArray(c) && c.length >= 2)
        .map((c) => [c[1], c[0]] as [number, number]);
      if (latlngs.length < 3) return;
      L.polygon(latlngs, {
        color: "#ffffff",
        weight: 2,
        fillColor: FACET_COLORS[i % FACET_COLORS.length],
        fillOpacity: 0.45,
      }).addTo(group);
      bounds.push(...latlngs);
    });
    facetLayerRef.current = group;
    if (bounds.length) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 21 });
  }

  function startEdit() {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    facetLayerRef.current?.remove();
    facetLayerRef.current = null;

    // Derive a single editable outline from the facets (their convex hull).
    const allPts = facetRings().flat();
    let ring = convexHullRing(allPts);
    if (ring.length < 4) {
      // Fallback: a small default rectangle around the property point.
      const d = 0.00018;
      ring = [
        [lon - d, lat - d], [lon + d, lat - d],
        [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d],
      ];
    }
    const latlngs = ring.map((c) => [c[1], c[0]] as [number, number]);

    const poly = L.polygon(latlngs, {
      color: EDIT_COLOR,
      weight: 3,
      fillColor: EDIT_COLOR,
      fillOpacity: 0.18,
    }).addTo(map);
    editLayerRef.current = poly;

    /* eslint-disable @typescript-eslint/no-explicit-any */
    (poly as any).pm.enable({ allowSelfIntersection: false });
    (poly as any).pm.enableLayerDrag();
    poly.on(
      "pm:edit pm:dragend pm:markerdragend pm:vertexadded pm:vertexremoved",
      () => recompute(getRing(), pitchRiseRef.current)
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */

    map.fitBounds(poly.getBounds(), { padding: [60, 60], maxZoom: 21 });
    recompute(ring, pitchRiseRef.current);
    setMode("edit");
  }

  function cancelEdit() {
    setMode("view");
    drawFacets();
  }

  async function save() {
    if (saving) return;
    const ring = getRing();
    if (ring.length < 3) return;
    setSaving(true);
    const res = await fetch(`/api/reports/${reportId}/geometry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ footprint: ring, pitchRise }),
    });
    if (res.ok) {
      router.refresh();
      setMode("view"); // page data refreshes with the new facets
    } else {
      setSaving(false);
      alert("Could not save the roof. Please try again.");
    }
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="w-full h-[460px] rounded-lg overflow-hidden border bg-slate-100 z-0"
      />

      {/* View-mode: enter edit */}
      {ready && mode === "view" && (
        <button
          onClick={startEdit}
          className="absolute top-3 right-3 z-[500] inline-flex items-center gap-2 rounded-lg bg-white/95 px-3 py-2 text-sm font-medium text-slate-800 shadow-md ring-1 ring-black/5 backdrop-blur hover:bg-white"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
          Edit roof
        </button>
      )}

      {/* Edit-mode: control panel */}
      {mode === "edit" && (
        <div className="absolute inset-x-3 bottom-3 z-[500] rounded-xl bg-white/95 p-4 shadow-xl ring-1 ring-black/5 backdrop-blur md:inset-x-auto md:right-3 md:w-80">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Edit roof</h3>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
              live
            </span>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-slate-50 p-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Footprint</div>
              <div className="text-sm font-bold text-slate-900">{Math.round(live.footprint)}<span className="text-[10px] font-normal text-slate-500"> ft²</span></div>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Roof area</div>
              <div className="text-sm font-bold text-slate-900">{Math.round(live.surface)}<span className="text-[10px] font-normal text-slate-500"> ft²</span></div>
            </div>
            <div className="rounded-lg bg-slate-50 p-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Squares</div>
              <div className="text-sm font-bold text-slate-900">{live.squares.toFixed(1)}</div>
            </div>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <label htmlFor="pitch">Pitch</label>
              <span className="font-mono font-semibold text-slate-900">{pitchRise}/12</span>
            </div>
            <input
              id="pitch"
              type="range"
              min={1}
              max={18}
              value={pitchRise}
              onChange={(e) => handlePitch(Number(e.target.value))}
              className="mt-1 w-full accent-blue-600"
            />
          </div>

          <p className="mt-2 text-[11px] leading-snug text-slate-500">
            Drag the shape onto the correct house · drag corners to fit the roof · click an
            edge to add a corner · right-click a corner to remove it.
          </p>

          <div className="mt-3 flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save roof"}
            </button>
            <button
              onClick={cancelEdit}
              disabled={saving}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
