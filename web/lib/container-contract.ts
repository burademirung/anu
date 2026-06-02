export interface ContainerJob {
  reportId: string;
  propertyId: string;
  lat: number;
  lon: number;
}

export interface ContainerFacet {
  structureIndex: number;
  facetIndex: number;
  footprintAreaSqft: number;
  areaSqft: number;
  pitch: string | null;
  pitchDegrees: number | null;
  pitchConfidence: string | null;
  orientation: string | null;
  polygon: unknown; // GeoJSON
}

export interface ContainerEdge {
  edgeType: string;
  lengthFt: number;
  geometry: unknown; // GeoJSON
  leftFacetIndex: number | null;
  rightFacetIndex: number | null;
}

export interface ContainerResult {
  tier: "full" | "basic";
  modelVersion: string;
  roofAreaSqft: number;
  roofAreaSquares: number;
  numFacets: number;
  numStructures: number;
  wasteFactor: number | null;
  confidenceScore: number;
  pdfKey: string | null;
  overlayKey: string | null;
  imageryKey: string | null;
  facets: ContainerFacet[];
  edges: ContainerEdge[];
}

export function isContainerResult(v: unknown): v is ContainerResult {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    (r.tier === "full" || r.tier === "basic") &&
    typeof r.modelVersion === "string" &&
    typeof r.roofAreaSqft === "number" &&
    typeof r.numFacets === "number" &&
    typeof r.numStructures === "number" &&
    typeof r.confidenceScore === "number" &&
    Array.isArray(r.facets) &&
    Array.isArray(r.edges)
  );
}
