import Link from "next/link";
import SignInCard from "@/components/SignInCard";

/* ── content ──────────────────────────────────────────────────────────── */

const STATS = [
  { v: "90–95%", k: "pitch & facet accuracy" },
  { v: "60–90s", k: "per report" },
  { v: "Free", k: "for everyone · no limits" },
  { v: "100%", k: "on Cloudflare" },
];

const CAPABILITIES = [
  { t: "Total roof area", d: "Square feet and roofing squares, from the precise building footprint." },
  { t: "Per-facet pitch", d: "Rise/run and degrees for every roof plane, measured from LiDAR." },
  { t: "Edge lengths", d: "Ridge, hip, valley, rake and eave totals — classified automatically." },
  { t: "Waste factor", d: "Material-loss estimate derived from roof complexity and pitch." },
  { t: "Confidence score", d: "A transparent quality signal based on data coverage and source." },
  { t: "PDF + overlay", d: "A shareable report and the measured roof drawn over the aerial image." },
];

const PIPELINE = [
  { n: "01", t: "Address", s: "input", d: "A contractor enters a US property address." },
  { n: "02", t: "Geocode", s: "US Census Geocoder", d: "Address → lat/lon. Free, key-less, US-only." },
  { n: "03", t: "Footprint", s: "OpenStreetMap · Overpass", d: "The exact building outline at the point." },
  { n: "04", t: "Imagery", s: "NAIP · COG window", d: "Only the ~1 km² window via HTTP range reads." },
  { n: "05", t: "Elevation", s: "USGS 3DEP · PDAL", d: "The roof's 3-D LiDAR point cloud." },
  { n: "06", t: "Plane-fit", s: "RANSAC · SciPy", d: "Segment into facets; normals give pitch." },
  { n: "07", t: "Measure", s: "Shapely", d: "Areas, edge lengths by type, waste factor." },
  { n: "08", t: "Report", s: "ReportLab → R2", d: "PDF + overlay stored; results written to D1." },
];

const STACK = [
  {
    group: "Edge & Web", color: "#b07d28",
    items: [
      ["Cloudflare Workers", "globally distributed runtime"],
      ["@opennextjs/cloudflare", "Next.js → Worker adapter"],
      ["Next.js 16.2 · React 19", "App Router · server components"],
      ["NextAuth v5", "JWT sessions · credentials + OAuth"],
      ["bcryptjs", "password hashing"],
    ],
  },
  {
    group: "Data, async & state", color: "#0e7c86",
    items: [
      ["D1", "SQLite — source of truth"],
      ["R2", "PDFs · overlays · imagery"],
      ["Queues (+ DLQ)", "durable job dispatch"],
      ["Durable Objects", "rate-limit + per-user quota"],
      ["Drizzle ORM", "type-safe, wasm-free D1 access"],
    ],
  },
  {
    group: "ML pipeline", color: "#6d4ad6",
    items: [
      ["Cloudflare Containers", "stateless Python compute"],
      ["FastAPI + Uvicorn", "POST /process"],
      ["rasterio / GDAL", "Cloud-Optimized GeoTIFF reads"],
      ["PDAL", "3DEP LiDAR point clouds"],
      ["SciPy · Shapely · NumPy", "RANSAC plane-fit + geometry"],
    ],
  },
  {
    group: "Public data", color: "#1f8f63",
    items: [
      ["US Census Geocoder", "address → coordinates"],
      ["OpenStreetMap · Overpass", "building footprints"],
      ["NAIP · Planetary Computer", "aerial imagery (STAC COG)"],
      ["USGS 3DEP", "nationwide LiDAR"],
      ["ReportLab", "PDF generation"],
    ],
  },
];

/* ── primitives ───────────────────────────────────────────────────────── */

function Eyebrow({ n, label, color }: { n: string; label: string; color: string }) {
  return (
    <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.32em]">
      <span style={{ color }}>{n}</span>
      <span className="h-px w-8" style={{ background: color, opacity: 0.45 }} />
      <span className="text-slate-500">{label}</span>
    </div>
  );
}

function Rise({ delay = 0, className = "", children }: { delay?: number; className?: string; children: React.ReactNode }) {
  return (
    <div className={`anu-rise ${className}`} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/* ── architecture diagram ─────────────────────────────────────────────── */

function Node({ x, y, w, h, title, sub, sub2, color }: { x: number; y: number; w: number; h: number; title: string; sub: string; sub2?: string; color: string }) {
  return (
    <g filter="url(#softShadow)">
      <rect x={x} y={y} width={w} height={h} rx={12} fill="#ffffff" stroke="rgba(20,33,61,0.10)" />
      <rect x={x} y={y} width={4} height={h} rx={2} fill={color} />
      <text x={x + 18} y={y + (sub2 ? 28 : h / 2 - 2)} fontFamily="var(--font-display)" fontSize="16" fill="#15233b" fontWeight="600">{title}</text>
      <text x={x + 18} y={y + (sub2 ? 46 : h / 2 + 15)} fontFamily="var(--font-mono)" fontSize="9.5" fill="#64748b">{sub}</text>
      {sub2 && <text x={x + 18} y={y + 62} fontFamily="var(--font-mono)" fontSize="9.5" fill="#64748b">{sub2}</text>}
    </g>
  );
}

function Edge({ d, color, label, lx, ly }: { d: string; color: string; label: string; lx: number; ly: number }) {
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeDasharray="5 5" markerEnd="url(#arrow)" className="anu-flow" opacity="0.85" />
      <text x={lx} y={ly} fontFamily="var(--font-mono)" fontSize="9.5" fill="#475569" textAnchor="middle" stroke="#f7f5ef" strokeWidth="3" paintOrder="stroke">{label}</text>
    </g>
  );
}

function ArchitectureDiagram() {
  return (
    <div className="relative overflow-x-auto rounded-2xl border border-slate-900/[0.07] bg-white p-3 shadow-[0_30px_60px_-40px_rgba(20,33,61,0.4)]">
      {/* scan sweep */}
      <div aria-hidden className="anu-sweep pointer-events-none absolute inset-y-3 left-0 w-1/3 bg-gradient-to-r from-transparent via-[#e8b34a]/10 to-transparent" />
      <svg viewBox="0 0 1000 470" className="relative w-full min-w-[760px]" role="img" aria-label="Anu Cloudflare architecture: Browser to Worker to Queue to Consumer to ML Container, with Durable Objects, D1 and R2.">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" />
          </marker>
          <filter id="softShadow" x="-20%" y="-20%" width="140%" height="160%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#15233b" floodOpacity="0.12" />
          </filter>
        </defs>

        {/* edges (under nodes) */}
        <Edge d="M154 155 H208" color="#64748b" label="HTTPS" lx={181} ly={147} />
        <Edge d="M293 104 V70" color="#0e9aa7" label="guard" lx={324} ly={90} />
        <Edge d="M378 155 H440" color="#c79528" label="enqueue" lx={409} ly={147} />
        <Edge d="M556 155 H596" color="#7c5cff" label="consume" lx={576} ly={147} />
        <Edge d="M736 155 H792" color="#c79528" label="/process" lx={764} ly={147} />
        <Edge d="M300 206 L352 372" color="#c79528" label="read · write" lx={300} ly={300} />
        <Edge d="M650 182 C600 330 500 398 420 398" color="#2f9e6e" label="write results" lx={560} ly={350} />
        <Edge d="M884 202 V372" color="#7c5cff" label="PDF · overlay" lx={930} ly={290} />

        {/* nodes */}
        <Node x={24} y={128} w={130} h={54} title="Browser" sub="contractor" color="#64748b" />
        <Node x={208} y={104} w={170} h={102} title="Web Worker" sub="Next.js · OpenNext" sub2="sole DB writer" color="#c79528" />
        <Node x={214} y={12} w={158} h={56} title="Durable Objects" sub="rate-limit · quota" color="#0e9aa7" />
        <Node x={440} y={128} w={116} h={54} title="Queue" sub="anu-reports" color="#7c5cff" />
        <Node x={596} y={128} w={140} h={54} title="Consumer" sub="queue() handler" color="#c79528" />
        <Node x={792} y={108} w={184} h={94} title="ML Container" sub="Python · FastAPI" sub2="rasterio · PDAL · SciPy" color="#7c5cff" />
        <Node x={300} y={372} w={120} h={56} title="D1" sub="SQLite · truth" color="#2f9e6e" />
        <Node x={792} y={372} w={184} h={56} title="R2" sub="objects · artifacts" color="#2f9e6e" />
      </svg>
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────── */

export default function HomePage() {
  return (
    <div className="anu-grain relative min-h-screen overflow-hidden bg-[#f7f5ef] font-sans text-slate-600 selection:bg-[#e8b34a]/30">
      <div aria-hidden className="pointer-events-none absolute inset-0 anu-grid" />
      <div aria-hidden className="pointer-events-none absolute inset-0 anu-contours" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[680px]"
        style={{
          background:
            "radial-gradient(820px 460px at 84% -10%, rgba(232,179,74,0.18), transparent 60%)," +
            "radial-gradient(720px 520px at 6% 0%, rgba(14,154,167,0.10), transparent 55%)",
        }}
      />

      <div className="relative z-10">
        {/* header */}
        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-2xl font-semibold tracking-tight text-[#15233b]">Anu</span>
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.3em] text-[#b07d28] sm:inline">roof intelligence</span>
          </div>
          <nav className="flex items-center gap-6 font-mono text-[11px] uppercase tracking-[0.18em]">
            <a href="#how" className="hidden text-slate-500 transition hover:text-[#15233b] md:inline">How</a>
            <a href="#architecture" className="hidden text-slate-500 transition hover:text-[#15233b] md:inline">Architecture</a>
            <a href="#stack" className="hidden text-slate-500 transition hover:text-[#15233b] md:inline">Stack</a>
            <Link href="/register" className="rounded-full bg-[#15233b] px-4 py-2 text-white transition hover:bg-[#22324f]">Get started</Link>
          </nav>
        </header>

        {/* hero — pitch + sign-in card */}
        <section className="mx-auto max-w-6xl px-6 pb-16 pt-10 md:pt-14">
          <div className="grid items-start gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <Rise delay={0}>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#2f9e6e]/30 bg-[#2f9e6e]/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[#1f8f63]">
                  <span className="anu-pulse inline-block h-1.5 w-1.5 rounded-full bg-[#2f9e6e]" />
                  live · running on cloudflare
                </div>
              </Rise>
              <Rise delay={120}>
                <h1 className="mt-6 font-display text-5xl font-light leading-[0.98] tracking-tight text-[#15233b] md:text-6xl">
                  Roof intelligence,
                  <br />
                  <span className="text-[#b07d28]">measured from the sky.</span>
                </h1>
              </Rise>
              <Rise delay={240}>
                <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
                  Anu turns a property address into a complete roof-measurement report — area, per-facet
                  pitch, edge lengths and waste factor — from free public aerial imagery and LiDAR.
                  No site visit, no drone, no proprietary data.
                </p>
              </Rise>
              <Rise delay={360}>
                <a href="#how" className="mt-7 inline-block font-mono text-xs uppercase tracking-[0.2em] text-slate-500 transition hover:text-[#15233b]">See how it works ↓</a>
              </Rise>
            </div>

            <Rise delay={220}>
              <div className="rounded-2xl border border-slate-900/[0.07] bg-white p-7 shadow-[0_30px_60px_-30px_rgba(20,33,61,0.45)]">
                <SignInCard />
              </div>
            </Rise>
          </div>

          <Rise delay={520}>
            <dl className="mt-14 grid grid-cols-2 overflow-hidden rounded-2xl border border-slate-900/[0.07] bg-white shadow-[0_20px_40px_-30px_rgba(20,33,61,0.4)] md:grid-cols-4">
              {STATS.map((s, i) => (
                <div key={s.k} className={`px-6 py-7 ${i > 0 ? "border-l border-slate-900/[0.06]" : ""}`}>
                  <dt className="font-display text-3xl text-[#15233b]">{s.v}</dt>
                  <dd className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">{s.k}</dd>
                </div>
              ))}
            </dl>
          </Rise>
        </section>

        {/* 01 — what it is */}
        <section className="mx-auto max-w-6xl px-6 py-20">
          <Eyebrow n="01" label="What it is" color="#b07d28" />
          <div className="mt-8 grid gap-12 md:grid-cols-[0.95fr_1.05fr]">
            <h2 className="font-display text-4xl font-light leading-tight text-[#15233b] md:text-5xl">
              A low-cost alternative to legacy aerial-measurement services — built for roofers.
            </h2>
            <div className="space-y-5">
              <p>
                Commercial roof-measurement reports are slow and expensive. Anu produces the numbers a
                contractor needs to bid a job — total area, pitch, edges and a material waste factor —
                in about a minute, from public government data.
              </p>
              <p className="text-[#15233b]">
                And it&apos;s <span className="font-medium text-[#b07d28]">completely free</span> — unlimited
                reports, no card, no per-report fees. It runs on free public data and Cloudflare&apos;s edge,
                so it costs almost nothing to operate.
              </p>
            </div>
          </div>

          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <div key={c.t} className="group rounded-2xl border border-slate-900/[0.07] bg-white p-7 shadow-[0_1px_2px_rgba(20,33,61,0.04)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_44px_-24px_rgba(20,33,61,0.35)]">
                <div className="mb-4 h-px w-10 bg-[#e8b34a] transition-all duration-300 group-hover:w-16" />
                <h3 className="font-display text-xl text-[#15233b]">{c.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{c.d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 02 — how it works */}
        <section id="how" className="mx-auto max-w-6xl px-6 py-20">
          <Eyebrow n="02" label="How it works" color="#0e7c86" />
          <h2 className="mt-8 max-w-3xl font-display text-4xl font-light leading-tight text-[#15233b] md:text-5xl">
            One address in. Eight stages of public-data analysis out.
          </h2>

          <ol className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PIPELINE.map((p, i) => (
              <li
                key={p.n}
                className="anu-rise rounded-2xl border border-slate-900/[0.07] bg-white p-6 shadow-[0_1px_2px_rgba(20,33,61,0.04)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_44px_-24px_rgba(20,33,61,0.35)]"
                style={{ animationDelay: `${i * 70}ms` }}
              >
                <div className="font-mono text-[11px] tracking-[0.2em] text-[#0e7c86]">{p.n}</div>
                <h3 className="mt-4 font-display text-2xl text-[#15233b]">{p.t}</h3>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">{p.s}</div>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{p.d}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 font-mono text-[11px] leading-relaxed tracking-wide text-slate-500">
            Every property returns a complete report. Where LiDAR is unavailable, pitch is estimated from
            footprint geometry and the confidence score reflects it — never a blank or partial result.
          </p>
        </section>

        {/* 03 — architecture */}
        <section id="architecture" className="mx-auto max-w-6xl px-6 py-20">
          <Eyebrow n="03" label="Architecture" color="#6d4ad6" />
          <div className="mt-8 grid gap-10 md:grid-cols-[1fr_0.8fr] md:items-end">
            <h2 className="font-display text-4xl font-light leading-tight text-[#15233b] md:text-5xl">
              Entirely on Cloudflare — edge to container.
            </h2>
            <p className="text-slate-600">
              A single Worker serves the app and is the only writer to the database. Heavy work is handed
              off through a durable queue to a stateless Python container that returns results the Worker
              persists. No servers, no VMs, no Postgres, no Redis.
            </p>
          </div>

          <div className="mt-12">
            <ArchitectureDiagram />
          </div>
        </section>

        {/* 04 — technology */}
        <section id="stack" className="mx-auto max-w-6xl px-6 py-20">
          <Eyebrow n="04" label="Technology" color="#1f8f63" />
          <h2 className="mt-8 font-display text-4xl font-light leading-tight text-[#15233b] md:text-5xl">Every moving part.</h2>
          <div className="mt-14 grid gap-x-10 gap-y-12 md:grid-cols-2 lg:grid-cols-4">
            {STACK.map((col) => (
              <div key={col.group}>
                <h3 className="flex items-center gap-2 border-b border-slate-900/10 pb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: col.color }} />
                  {col.group}
                </h3>
                <ul className="mt-4 space-y-4">
                  {col.items.map(([name, role]) => (
                    <li key={name}>
                      <div className="text-sm font-medium text-[#15233b]">{name}</div>
                      <div className="font-mono text-[11px] leading-snug text-slate-500">{role}</div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto max-w-6xl px-6 pb-28 pt-6">
          <div className="relative overflow-hidden rounded-3xl border border-[#15233b]/10 bg-[#15233b] px-8 py-16 text-center">
            <div aria-hidden className="anu-grid pointer-events-none absolute inset-0 opacity-[0.15]" />
            <div aria-hidden className="anu-sweep pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-[#e8b34a]/12 to-transparent" />
            <div className="relative">
              <h2 className="mx-auto max-w-2xl font-display text-4xl font-light leading-tight text-white md:text-5xl">
                Measure your next roof before you finish your coffee.
              </h2>
              <Link
                href="/register"
                className="anu-sheen relative mt-9 inline-block overflow-hidden rounded-full bg-[#e8b34a] px-8 py-3.5 font-medium text-[#1a1407] shadow-[0_20px_50px_-12px_rgba(232,179,74,0.7)] transition hover:bg-[#f2c463]"
              >
                Create free account
              </Link>
              <div className="mt-4 font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">Completely free · no card required</div>
            </div>
          </div>
        </section>

        {/* footer */}
        <footer className="border-t border-slate-900/10">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500 sm:flex-row">
            <span className="font-display text-base normal-case tracking-tight text-[#15233b]">Anu</span>
            <span className="text-center">NAIP · 3DEP · OpenStreetMap · US Census — public data</span>
            <span>Running entirely on Cloudflare</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
