/**
 * Pure roof geometry: given a footprint outline (lon/lat ring) and a pitch,
 * compute a hip-roof facet/edge breakdown and the measurements. Shared by the
 * client (live preview while editing) and the server (authoritative save), so
 * an edited roof produces identical numbers in both places.
 *
 * Mirrors ml-service/app/pipeline/roof_estimator.py + measurer.calculate_full,
 * but the oriented bounding box uses PCA (no shapely dependency).
 */

const M_TO_FT = 3.28084;
const M2_TO_FT2 = M_TO_FT * M_TO_FT;

export interface RoofFacet {
  structureIndex: number;
  facetIndex: number;
  footprintAreaSqft: number;
  areaSqft: number;
  pitch: string;
  pitchDegrees: number;
  pitchConfidence: string;
  orientation: string | null;
  polygon: { type: "Polygon"; coordinates: number[][][] };
}

export interface RoofEdge {
  edgeType: string;
  lengthFt: number;
  geometry: { type: "LineString"; coordinates: number[][] };
  leftFacetIndex: number | null;
  rightFacetIndex: number | null;
}

export interface RoofResult {
  footprintAreaSqft: number;
  facets: RoofFacet[];
  edges: RoofEdge[];
  roofAreaSqft: number;
  roofAreaSquares: number;
  numFacets: number;
  numStructures: number;
  wasteFactor: number;
}

type Pt = [number, number];

function openRing(ring: number[][]): number[][] {
  if (ring.length > 1) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  }
  return ring;
}

function shoelaceArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

function compass(dx: number, dy: number): string {
  const angle = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  const dirs: [number, string][] = [
    [22.5, "N"], [67.5, "NE"], [112.5, "E"], [157.5, "SE"],
    [202.5, "S"], [247.5, "SW"], [292.5, "W"], [337.5, "NW"], [360, "N"],
  ];
  for (const [t, d] of dirs) if (angle < t) return d;
  return "N";
}

/** PCA-aligned oriented bounding box → 4 corners A,B,C,D (CCW-ish). */
function obbCorners(pts: Pt[]): Pt[] {
  const n = pts.length;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;

  let a = 0, b = 0, c = 0;
  for (const p of pts) {
    const dx = p[0] - mx, dy = p[1] - my;
    a += dx * dx; b += dx * dy; c += dy * dy;
  }
  a /= n; b /= n; c /= n;

  const tr = a + c;
  const det = a * c - b * b;
  const disc = Math.sqrt(Math.max((tr * tr) / 4 - det, 0));
  const l1 = tr / 2 + disc;

  let ux: number, uy: number;
  if (Math.abs(b) > 1e-12) { ux = l1 - c; uy = b; }
  else if (a >= c) { ux = 1; uy = 0; }
  else { ux = 0; uy = 1; }
  const ul = Math.hypot(ux, uy) || 1;
  ux /= ul; uy /= ul;
  const vx = -uy, vy = ux;

  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const p of pts) {
    const dx = p[0] - mx, dy = p[1] - my;
    const pu = dx * ux + dy * uy;
    const pv = dx * vx + dy * vy;
    if (pu < minU) minU = pu; if (pu > maxU) maxU = pu;
    if (pv < minV) minV = pv; if (pv > maxV) maxV = pv;
  }
  const corner = (u: number, v: number): Pt => [mx + ux * u + vx * v, my + uy * u + vy * v];
  return [corner(minU, minV), corner(maxU, minV), corner(maxU, maxV), corner(minU, maxV)];
}

/**
 * Build a hip-roof breakdown for *ring* (lon/lat) at *pitchRise* (rise per 12).
 * Footprint area is the exact area of the drawn ring; facet plan areas are
 * scaled to sum to it; surface areas are footprint / cos(pitch).
 */
export function estimateRoofFromFootprint(
  ring: number[][],
  pitchRise: number,
  pitchConfidence = "manual"
): RoofResult {
  const empty: RoofResult = {
    footprintAreaSqft: 0, facets: [], edges: [],
    roofAreaSqft: 0, roofAreaSquares: 0, numFacets: 0, numStructures: 0, wasteFactor: 0,
  };
  const pts = openRing(ring);
  if (pts.length < 3) return empty;

  const cosLat = Math.cos((pts.reduce((s, p) => s + p[1], 0) / pts.length) * Math.PI / 180) || 1e-6;
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const toM = (lon: number, lat: number): Pt => [(lon - cx) * 111000 * cosLat, (lat - cy) * 111000];
  const toLL = (x: number, y: number): number[] => [cx + x / (111000 * cosLat), cy + y / 111000];

  const ptsM = pts.map((p) => toM(p[0], p[1]));
  const footprintAreaSqft = shoelaceArea(ptsM) * M2_TO_FT2;
  if (footprintAreaSqft < 1) return empty;

  let [A, B, C, D] = obbCorners(ptsM);
  // Make A->B the long side so the ridge runs along the long axis.
  if (Math.hypot(B[0] - A[0], B[1] - A[1]) < Math.hypot(C[0] - B[0], C[1] - B[1])) {
    [A, B, C, D] = [B, C, D, A];
  }
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const S = Math.hypot(C[0] - B[0], C[1] - B[1]);
  if (L < 1e-6) return empty;

  const ridgeLen = Math.max(L - S, 0);
  const mx = (A[0] + C[0]) / 2, my = (A[1] + C[1]) / 2;
  const ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
  const r1: Pt = [mx - ux * ridgeLen / 2, my - uy * ridgeLen / 2];
  const r2: Pt = [mx + ux * ridgeLen / 2, my + uy * ridgeLen / 2];

  const pitchDeg = (Math.atan2(pitchRise, 12) * 180) / Math.PI;
  const cosP = Math.cos((pitchDeg * Math.PI) / 180) || 1e-6;
  const pitchStr = `${pitchRise}/12`;

  const specs: Pt[][] = [
    [A, B, r2, r1],
    [C, D, r1, r2],
    [B, C, r2],
    [D, A, r1],
  ];
  const planAreas = specs.map((s) => shoelaceArea(s));
  const totalPlan = planAreas.reduce((a, b) => a + b, 0) || 1e-6;

  const facets: RoofFacet[] = specs.map((spec, i) => {
    const planSqft = footprintAreaSqft * (planAreas[i] / totalPlan);
    const surfSqft = planSqft / cosP;
    const emx = (spec[0][0] + spec[1][0]) / 2;
    const emy = (spec[0][1] + spec[1][1]) / 2;
    const ll = spec.map(([x, y]) => toLL(x, y));
    ll.push(ll[0]);
    return {
      structureIndex: 0,
      facetIndex: i,
      footprintAreaSqft: round(planSqft, 2),
      areaSqft: round(surfSqft, 2),
      pitch: pitchStr,
      pitchDegrees: round(pitchDeg, 2),
      pitchConfidence,
      orientation: compass(emx - mx, emy - my),
      polygon: { type: "Polygon", coordinates: [ll] },
    };
  });

  const edge = (p: Pt, q: Pt, type: string): RoofEdge => ({
    edgeType: type,
    lengthFt: round(Math.hypot(q[0] - p[0], q[1] - p[1]) * M_TO_FT, 2),
    geometry: { type: "LineString", coordinates: [toLL(...p), toLL(...q)] },
    leftFacetIndex: null,
    rightFacetIndex: null,
  });
  const edges: RoofEdge[] = [];
  if (ridgeLen > 0.5) edges.push(edge(r1, r2, "ridge"));
  for (const [re, corner] of [[r1, A], [r1, D], [r2, B], [r2, C]] as [Pt, Pt][]) {
    edges.push(edge(re, corner, "hip"));
  }
  for (const [p, q] of [[A, B], [B, C], [C, D], [D, A]] as [Pt, Pt][]) {
    edges.push(edge(p, q, "eave"));
  }

  const roofAreaSqft = facets.reduce((s, f) => s + f.areaSqft, 0);
  const numHips = edges.filter((e) => e.edgeType === "hip").length;
  const numValleys = edges.filter((e) => e.edgeType === "valley").length;
  let waste = 10 + numValleys * 2 + numHips * 1;
  if (pitchDeg > 33.69) waste += 3;
  if (facets.length > 6) waste += 2;
  waste = Math.min(waste, 25);

  return {
    footprintAreaSqft: round(footprintAreaSqft, 1),
    facets,
    edges,
    roofAreaSqft: round(roofAreaSqft, 1),
    roofAreaSquares: round(roofAreaSqft / 100, 2),
    numFacets: facets.length,
    numStructures: 1,
    wasteFactor: waste,
  };
}

function round(n: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

/**
 * Convex hull (Andrew's monotone chain) of lon/lat points, returned as a closed
 * ring. Used to derive a single editable outline from the individual facet
 * polygons. Planar math is fine at building scale.
 */
export function convexHullRing(points: number[][]): number[][] {
  const pts = points
    .filter((p) => Array.isArray(p) && p.length >= 2)
    .map((p) => [p[0], p[1]] as Pt)
    .sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  if (pts.length < 3) return pts.map((p) => [p[0], p[1]]);

  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  const ring = hull.map((p) => [p[0], p[1]]);
  if (ring.length) ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

/** Centroid (lon/lat) of a ring, for relocating the property to the edited roof. */
export function ringCentroid(ring: number[][]): { lat: number; lon: number } {
  const pts = openRing(ring);
  const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return { lat, lon };
}
