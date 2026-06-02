import { describe, it, expect } from "vitest";
import { PLAN, REPORT_STATUS, EDGE_TYPE, isEdgeType, isReportStatus } from "@/lib/enums";

describe("enums", () => {
  it("exposes the full value sets", () => {
    expect(PLAN).toEqual(["free", "premium"]);
    expect(REPORT_STATUS).toEqual(["queued", "processing", "completed", "failed"]);
    expect(EDGE_TYPE).toEqual(["ridge", "hip", "valley", "rake", "eave", "flashing"]);
  });

  it("guards accept valid values and reject invalid ones", () => {
    expect(isReportStatus("completed")).toBe(true);
    expect(isReportStatus("done")).toBe(false);
    expect(isEdgeType("ridge")).toBe(true);
    expect(isEdgeType("gutter")).toBe(false);
  });
});
