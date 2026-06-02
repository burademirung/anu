# Anu ML Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full ML processing pipeline that takes a property location and produces a roof measurement report with facets, edges, pitch, and PDF.

**Architecture:** The ML service (FastAPI + Celery worker) receives job requests from Next.js, fetches aerial imagery (NAIP/Mapbox), runs U-Net roof segmentation, fetches 3DEP LiDAR data, performs RANSAC plane fitting to extract facets/edges, calculates measurements, generates PDF, and writes results to Postgres + MinIO.

**Tech Stack:** Python 3.12, FastAPI, Celery, Redis, psycopg2, MinIO (minio-py), PyTorch (segmentation-models-pytorch), Open3D, PDAL, NumPy, Shapely, ReportLab, requests

**Spec:** `docs/superpowers/specs/2026-03-16-anu-system-design.md` (Sections 2 + 4)

**Note:** The U-Net model starts with random weights. Training is a separate effort. Reports will generate but segmentation won't be accurate until trained.

---

## Tasks Overview

15 tasks across 4 chunks:
1. **Infrastructure** (Tasks 1-5): config, db, storage, geo utils, Celery
2. **Imagery Pipeline** (Tasks 6-8): NAIP, Mapbox, fetcher, stitcher, U-Net
3. **LiDAR + Geometry** (Tasks 9-12): LiDAR, RANSAC, edges, measurements
4. **Output + Orchestrator** (Tasks 13-15): PDF, orchestrator, Docker Compose update

Each task creates 1-3 files with tests where applicable. All code is synchronous (Celery requirement).
