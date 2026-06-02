import { describe, it, expect } from "vitest";
import { toJsonColumn, fromJsonColumn } from "@/lib/json-columns";

describe("json-columns", () => {
  it("round-trips a GeoJSON polygon", () => {
    const poly = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    const stored = toJsonColumn(poly);
    expect(typeof stored).toBe("string");
    expect(fromJsonColumn(stored)).toEqual(poly);
  });

  it("treats null/undefined as null both ways", () => {
    expect(toJsonColumn(null)).toBeNull();
    expect(toJsonColumn(undefined)).toBeNull();
    expect(fromJsonColumn(null)).toBeNull();
  });

  it("returns null for unparseable stored text instead of throwing", () => {
    expect(fromJsonColumn("not json{")).toBeNull();
  });
});
