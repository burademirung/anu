export const PLAN = ["free", "premium"] as const;
export const REPORT_STATUS = ["queued", "processing", "completed", "failed"] as const;
export const REPORT_TIER = ["full", "basic"] as const;
export const IMAGERY_SOURCE = ["naip", "mapbox"] as const;
export const PITCH_CONFIDENCE = ["measured", "user_provided"] as const;
export const EDGE_TYPE = ["ridge", "hip", "valley", "rake", "eave", "flashing"] as const;

export type Plan = (typeof PLAN)[number];
export type ReportStatus = (typeof REPORT_STATUS)[number];
export type ReportTier = (typeof REPORT_TIER)[number];
export type ImagerySource = (typeof IMAGERY_SOURCE)[number];
export type PitchConfidence = (typeof PITCH_CONFIDENCE)[number];
export type EdgeType = (typeof EDGE_TYPE)[number];

const guard = <T extends readonly string[]>(set: T) =>
  (v: unknown): v is T[number] => typeof v === "string" && (set as readonly string[]).includes(v);

export const isPlan = guard(PLAN);
export const isReportStatus = guard(REPORT_STATUS);
export const isReportTier = guard(REPORT_TIER);
export const isImagerySource = guard(IMAGERY_SOURCE);
export const isPitchConfidence = guard(PITCH_CONFIDENCE);
export const isEdgeType = guard(EDGE_TYPE);
