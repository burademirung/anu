import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

/**
 * Drizzle schema mapping the existing D1 tables (see web/migrations/0001_init.sql).
 * Wasm-free — works natively on Cloudflare Workers (replaces Prisma).
 *
 * Dates use `integer({ mode: "timestamp" })`: Drizzle reads/writes them as JS
 * `Date` objects (stored as unix seconds). SQLite's loose typing accepts these
 * in the existing DATETIME columns. Enum-like columns are plain TEXT, validated
 * in app code (web/lib/enums.ts). GeoJSON columns are TEXT (see web/lib/json-columns.ts).
 */
const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date());
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date());

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  companyName: text("company_name"),
  passwordHash: text("password_hash"),
  plan: text("plan").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  monthlyReportLimit: integer("monthly_report_limit").default(5),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const properties = sqliteTable("properties", {
  id: id(),
  userId: text("user_id").notNull(),
  addressRaw: text("address_raw").notNull(),
  addressNormalized: text("address_normalized").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  parcelBoundary: text("parcel_boundary"),
  imagerySource: text("imagery_source"),
  imageryCaptureDate: integer("imagery_capture_date", { mode: "timestamp" }),
  imageryPath: text("imagery_path"),
  lidarAvailable: integer("lidar_available", { mode: "boolean" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const reports = sqliteTable("reports", {
  id: id(),
  propertyId: text("property_id").notNull(),
  userId: text("user_id").notNull(),
  status: text("status").notNull().default("queued"),
  tier: text("tier"),
  modelVersion: text("model_version"),
  roofAreaSqft: real("roof_area_sqft"),
  roofAreaSquares: real("roof_area_squares"),
  numFacets: integer("num_facets"),
  numStructures: integer("num_structures"),
  wasteFactor: real("waste_factor"),
  confidenceScore: real("confidence_score"),
  pdfUrl: text("pdf_url"),
  overlayUrl: text("overlay_url"),
  retryCount: integer("retry_count").notNull().default(0),
  errorMessage: text("error_message"),
  processingStartedAt: integer("processing_started_at", { mode: "timestamp" }),
  processingCompletedAt: integer("processing_completed_at", { mode: "timestamp" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const reportFacets = sqliteTable("report_facets", {
  id: id(),
  reportId: text("report_id").notNull(),
  structureIndex: integer("structure_index").notNull(),
  facetIndex: integer("facet_index").notNull(),
  footprintAreaSqft: real("footprint_area_sqft").notNull(),
  areaSqft: real("area_sqft").notNull(),
  pitch: text("pitch"),
  pitchDegrees: real("pitch_degrees"),
  pitchConfidence: text("pitch_confidence"),
  orientation: text("orientation"),
  polygon: text("polygon").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const reportEdges = sqliteTable("report_edges", {
  id: id(),
  reportId: text("report_id").notNull(),
  edgeType: text("edge_type").notNull(),
  lengthFt: real("length_ft").notNull(),
  geometry: text("geometry").notNull(),
  leftFacetId: text("left_facet_id"),
  rightFacetId: text("right_facet_id"),
});

export const usersRelations = relations(users, ({ many }) => ({
  properties: many(properties),
  reports: many(reports),
}));
export const propertiesRelations = relations(properties, ({ one, many }) => ({
  user: one(users, { fields: [properties.userId], references: [users.id] }),
  reports: many(reports),
}));
export const reportsRelations = relations(reports, ({ one, many }) => ({
  property: one(properties, { fields: [reports.propertyId], references: [properties.id] }),
  user: one(users, { fields: [reports.userId], references: [users.id] }),
  facets: many(reportFacets),
  edges: many(reportEdges),
}));
export const reportFacetsRelations = relations(reportFacets, ({ one }) => ({
  report: one(reports, { fields: [reportFacets.reportId], references: [reports.id] }),
}));
export const reportEdgesRelations = relations(reportEdges, ({ one }) => ({
  report: one(reports, { fields: [reportEdges.reportId], references: [reports.id] }),
}));
