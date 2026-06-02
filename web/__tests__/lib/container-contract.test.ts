import { describe, it, expect } from "vitest";
import { isContainerResult } from "@/lib/container-contract";

const good = {
  tier: "full", modelVersion: "v1.0",
  roofAreaSqft: 2000, roofAreaSquares: 20, numFacets: 4, numStructures: 1,
  wasteFactor: 14, confidenceScore: 0.9,
  pdfKey: "reports/r1/report.pdf", overlayKey: "reports/r1/overlay.png", imageryKey: "imagery/x.png",
  facets: [{ structureIndex: 0, facetIndex: 0, footprintAreaSqft: 1000, areaSqft: 1100, pitch: "6/12", pitchDegrees: 26.57, pitchConfidence: "measured", orientation: "S", polygon: { type: "Polygon", coordinates: [] } }],
  edges: [{ edgeType: "ridge", lengthFt: 30, geometry: { type: "LineString", coordinates: [] }, leftFacetIndex: 0, rightFacetIndex: null }],
};

describe("isContainerResult", () => {
  it("accepts a well-formed full result", () => expect(isContainerResult(good)).toBe(true));
  it("rejects missing tier", () => expect(isContainerResult({ ...good, tier: undefined })).toBe(false));
  it("rejects a non-array facets", () => expect(isContainerResult({ ...good, facets: "x" })).toBe(false));
  it("rejects null", () => expect(isContainerResult(null)).toBe(false));
});
