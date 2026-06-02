-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company_name" TEXT,
    "password_hash" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "monthly_report_limit" INTEGER DEFAULT 5,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "address_raw" TEXT NOT NULL,
    "address_normalized" TEXT NOT NULL,
    "lat" REAL NOT NULL,
    "lon" REAL NOT NULL,
    "parcel_boundary" TEXT,
    "imagery_source" TEXT,
    "imagery_capture_date" DATETIME,
    "imagery_path" TEXT,
    "lidar_available" BOOLEAN,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "properties_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "property_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "tier" TEXT,
    "model_version" TEXT,
    "roof_area_sqft" REAL,
    "roof_area_squares" REAL,
    "num_facets" INTEGER,
    "num_structures" INTEGER,
    "waste_factor" REAL,
    "confidence_score" REAL,
    "pdf_url" TEXT,
    "overlay_url" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "processing_started_at" DATETIME,
    "processing_completed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "reports_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "report_facets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "report_id" TEXT NOT NULL,
    "structure_index" INTEGER NOT NULL,
    "facet_index" INTEGER NOT NULL,
    "footprint_area_sqft" REAL NOT NULL,
    "area_sqft" REAL NOT NULL,
    "pitch" TEXT,
    "pitch_degrees" REAL,
    "pitch_confidence" TEXT,
    "orientation" TEXT,
    "polygon" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "report_facets_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "report_edges" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "report_id" TEXT NOT NULL,
    "edge_type" TEXT NOT NULL,
    "length_ft" REAL NOT NULL,
    "geometry" TEXT NOT NULL,
    "left_facet_id" TEXT,
    "right_facet_id" TEXT,
    CONSTRAINT "report_edges_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "report_edges_left_facet_id_fkey" FOREIGN KEY ("left_facet_id") REFERENCES "report_facets" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "report_edges_right_facet_id_fkey" FOREIGN KEY ("right_facet_id") REFERENCES "report_facets" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "properties_user_id_idx" ON "properties"("user_id");

-- CreateIndex
CREATE INDEX "properties_lat_lon_idx" ON "properties"("lat", "lon");

-- CreateIndex
CREATE INDEX "reports_user_id_created_at_idx" ON "reports"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- CreateIndex
CREATE INDEX "reports_user_id_status_idx" ON "reports"("user_id", "status");

-- CreateIndex
CREATE INDEX "report_facets_report_id_idx" ON "report_facets"("report_id");

-- CreateIndex
CREATE INDEX "report_edges_report_id_idx" ON "report_edges"("report_id");

