"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  OPEN_DATA_LICENSE,
  PublicDatasetJsonResponseSchema,
  PublicDatasetListResponseSchema,
  type PublicDatasetJsonResponse,
  type PublicDatasetListResponse,
  type PublicDatasetSummary,
} from "@groundtruth/shared";
import { Mark } from "../ds/Mark";
import { COLORS } from "../ds/tokens";
import { AskPanel } from "./AskPanel";
import { HexCoverage } from "./HexCoverage";

/**
 * /data — public open-data page. Minimal black aesthetic: #000, white, hairline grey rules,
 * uppercase letter-spaced condensed headings, one accent colour.
 */
/** The design-system accent (components/ds/tokens.ts). */
const ACCENT = COLORS.accent;
const PREVIEW_ROWS = 20;
const LIST_REFRESH_MS = 60_000;
const PREVIEW_REFRESH_MS = 30_000;

const HEAD = "font-[family-name:var(--font-display)] uppercase tracking-[0.18em]";

export function OpenDataPage() {
  const [list, setList] = useState<PublicDatasetListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/public/datasets", { cache: "no-store" });
        if (!res.ok) throw new Error("list unavailable");
        const body = PublicDatasetListResponseSchema.parse(await res.json());
        if (alive) {
          setList(body);
          setError(null);
        }
      } catch {
        // Keep showing the last good list; the catalogue refreshes itself every minute.
        if (alive) setError("The dataset catalogue is temporarily unavailable. It retries automatically, or reload the page.");
      }
    };
    void load();
    const t = setInterval(() => void load(), LIST_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const totals = list
    ? {
        datasets: list.datasets.length,
        rows: list.datasets.reduce((a, d) => a + d.rows, 0),
        contributors: list.datasets.reduce((a, d) => a + d.contributors, 0),
        cells: list.datasets.reduce((a, d) => a + d.cells.length, 0),
      }
    : null;

  return (
    <div className="min-h-screen bg-black text-white antialiased">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-black/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-8">
          <Link href="/data" className={`${HEAD} flex items-center gap-2.5 text-sm font-semibold tracking-[0.35em]!`}>
            <Mark className="size-6" />
            GroundTruth
          </Link>
          <nav className={`${HEAD} flex items-center gap-5 text-[11px] text-white/60 sm:gap-8`}>
            <a href="#datasets" className="hover:text-white">Datasets</a>
            <a href="#ask" className="hover:text-white">Ask</a>
            <a href="#method" className="hidden hover:text-white sm:inline">Method</a>
            <Link href="/funding" className="hover:text-white">Funding</Link>
            <Link href="/login" className="hover:text-white">Researchers</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pt-20 pb-16 sm:px-8 sm:pt-32 sm:pb-24">
          <p className={`${HEAD} text-[11px] text-white/50`}>
            Open data <span style={{ color: ACCENT }}>·</span> {OPEN_DATA_LICENSE.short_name} <span style={{ color: ACCENT }}>·</span> No login
          </p>
          <h1 className={`${HEAD} mt-6 text-4xl leading-[1.05] font-semibold tracking-[0.06em]! sm:text-7xl`}>
            Open data.
            <br />
            Free for every scientist.
          </h1>
          <p className="mt-8 max-w-2xl text-base leading-relaxed text-white/65 sm:text-lg">
            Verified, research-grade field observations collected by people on the ground. Sponsors pay to direct where data is
            collected; every structured row is published here for everyone. Photos stay private.
          </p>
          {totals ? (
            <dl className="mt-14 grid grid-cols-2 border-t border-white/15 sm:grid-cols-4">
              <Figure label="Datasets" value={totals.datasets} />
              <Figure label="Observations" value={totals.rows} />
              <Figure label="Contributors" value={totals.contributors} />
              <Figure label="H3 cells" value={totals.cells} />
            </dl>
          ) : null}
        </section>

        <section id="datasets" className="border-t border-white/10">
          <div className="mx-auto max-w-6xl px-4 sm:px-8">
            {error && !list ? <Notice>{error}</Notice> : null}
            {error && list ? <p className={`${HEAD} pt-6 text-[10px] text-white/55`}>Reconnecting… showing the last loaded catalogue.</p> : null}
            {!list && !error ? <p className={`${HEAD} py-16 text-[11px] text-white/55`}>Loading datasets…</p> : null}
            {list && list.datasets.length === 0 ? (
              <Notice title="No datasets published yet">
                A dataset appears here as soon as a protocol is published. Rows are added only after verification, so there is
                nothing unvetted to download.
              </Notice>
            ) : null}
            {list?.datasets.map((d) => <DatasetSection key={d.slug} d={d} />)}
          </div>
        </section>

        {list && list.datasets.length > 0 ? (
          <section id="ask" className="scroll-mt-16 border-t border-white/10">
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-8 sm:py-24">
              <p className={`${HEAD} text-[11px] text-white/55`}>Ask the data</p>
              <h2 className={`${HEAD} mt-3 mb-8 text-3xl font-semibold tracking-[0.08em]! sm:text-5xl`}>Ask a question</h2>
              <AskPanel mode="public" />
            </div>
          </section>
        ) : null}

        <Method />
      </main>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-10 text-xs text-white/55 sm:flex-row sm:justify-between sm:px-8">
          <span>
            Data: {OPEN_DATA_LICENSE.short_name}, attribution &ldquo;{OPEN_DATA_LICENSE.attribution}&rdquo;.
          </span>
          <span>
            API: <code className="text-white/60">GET /api/public/datasets</code>
          </span>
        </div>
      </footer>
    </div>
  );
}

function Figure({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="border-b border-white/15 py-5 pr-4 sm:border-r sm:border-b-0 sm:px-5 sm:first:pl-0 sm:last:border-r-0">
      <dt className={`${HEAD} text-[10px] text-white/55`}>{label}</dt>
      <dd className="mt-2 text-2xl font-light tabular-nums sm:text-3xl">{value}</dd>
      {sub ? <dd className="mt-1 text-[11px] text-white/55">{sub}</dd> : null}
    </div>
  );
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function DatasetSection({ d }: { d: PublicDatasetSummary }) {
  return (
    <article id={d.slug} className="scroll-mt-16 border-b border-white/10 py-16 sm:py-24">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <p className={`${HEAD} text-[11px] text-white/55`}>
            Dataset <span className="text-white/25">/</span> {d.slug} <span className="text-white/25">/</span> v{d.version}
          </p>
          <h2 className={`${HEAD} mt-3 text-3xl font-semibold tracking-[0.08em]! sm:text-5xl`}>{d.name}</h2>
        </div>
        {d.includes_demo_rows ? (
          <span className={`${HEAD} border border-amber-300/40 px-2 py-1 text-[10px] text-amber-200`}>Includes demo rows</span>
        ) : null}
      </div>
      <p className="mt-5 max-w-3xl leading-relaxed text-white/60">{d.description}</p>

      {d.sponsors.length ? (
        <p className={`${HEAD} mt-8 text-[11px] text-white/55`}>
          Funded by{" "}
          {d.sponsors.map((s, i) => (
            <span key={s.name}>
              {i ? ", " : ""}
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer" className="text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
                  {s.name}
                </a>
              ) : (
                <span className="text-white">{s.name}</span>
              )}
            </span>
          ))}{" "}
          <span style={{ color: ACCENT }}>—</span> data free for everyone
        </p>
      ) : null}

      {d.rows === 0 ? (
        <Notice title="Collection under way">
          No observations have been published yet. A row appears here only after a person approves it or the verification
          pipeline accepts it at confidence ≥ 0.75. The schema, data dictionary and citation below are ready now.
        </Notice>
      ) : null}

      <dl className="mt-10 grid grid-cols-2 border-t border-white/15 sm:grid-cols-4">
        <Figure
          label="Observations"
          value={d.rows}
          sub={`${d.tiers.human_verified} human-verified · ${d.tiers.model_high} model ≥ 0.75`}
        />
        <Figure label="Contributors" value={d.contributors} sub="pseudonymous" />
        <Figure label="Coverage" value={d.cells.length} sub="H3 res-9 cells" />
        <Figure
          label="Time range"
          value={<span className="text-base sm:text-lg">{d.time_range ? fmtTime(d.time_range.end) : "—"}</span>}
          sub={d.time_range ? `since ${fmtTime(d.time_range.start)}` : "no rows yet"}
        />
      </dl>

      <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className={d.rows === 0 ? "hidden" : undefined}>
          <SectionLabel>Observation hexes</SectionLabel>
          <div className="mt-4 aspect-square w-full border border-white/10">
            <HexCoverage cells={d.cells} accent={ACCENT} className="h-full w-full" />
          </div>
          {d.bbox ? (
            <p className="mt-3 font-mono text-[11px] text-white/55">
              bbox {d.bbox.map((x) => x.toFixed(4)).join(", ")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-10">
          <Downloads d={d} />
          <Cite d={d} />
        </div>
      </div>

      {d.rows > 0 ? <Preview slug={d.slug} total={d.rows} /> : null}
    </article>
  );
}

/** Calm, on-brand message block (empty states and temporary outages). */
function Notice({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="my-12 border-l-2 py-2 pl-5" style={{ borderColor: ACCENT }} role="status">
      {title ? <p className={`${HEAD} text-xs font-semibold text-white`}>{title}</p> : null}
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/60">{children}</p>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className={`${HEAD} border-b border-white/10 pb-3 text-[11px] text-white/55`}>{children}</h3>;
}

function Downloads({ d }: { d: PublicDatasetSummary }) {
  const items = [
    { href: d.downloads.csv, label: "CSV", note: "one row per observation" },
    { href: d.downloads.geojson, label: "GeoJSON", note: "points at cell centres" },
    { href: d.downloads.json, label: "JSON", note: "columns + rows" },
    { href: d.downloads.dictionary, label: "Data dictionary", note: "columns, license, coarsening" },
  ];
  return (
    <div>
      <SectionLabel>Download</SectionLabel>
      <ul className="mt-2">
        {items.map((x) => (
          <li key={x.label} className="border-b border-white/10">
            <a
              href={x.href}
              className="group flex items-center justify-between py-4 transition-colors hover:text-white"
              {...(x.label === "CSV" || x.label === "GeoJSON" ? { download: true } : { target: "_blank", rel: "noreferrer" })}
            >
              <span className={`${HEAD} text-sm`}>{x.label}</span>
              <span className="flex items-center gap-3 text-xs text-white/55">
                {x.note}
                <span className="text-base transition-transform group-hover:translate-x-1" style={{ color: ACCENT }} aria-hidden>
                  →
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs leading-relaxed text-white/55">
        Licensed{" "}
        <a href={d.license.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-white">
          {d.license.short_name}
        </a>
        . Attribute &ldquo;{d.license.attribution}&rdquo;. Locations are snapped to H3 cell centres and times to 5-minute
        windows; contributor ids are per-dataset pseudonyms.
      </p>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`${HEAD} cursor-pointer text-[10px] text-white/50 hover:text-white`}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
          .catch(() => undefined);
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function Cite({ d }: { d: PublicDatasetSummary }) {
  return (
    <div>
      <SectionLabel>Cite this dataset</SectionLabel>
      <div className="mt-4 flex items-start justify-between gap-4">
        <p className="text-sm leading-relaxed text-white/75">{d.citation.text}</p>
        <CopyButton text={d.citation.text} />
      </div>
      <div className="mt-5 border border-white/10">
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <span className={`${HEAD} text-[10px] text-white/55`}>BibTeX</span>
          <CopyButton text={d.citation.bibtex} />
        </div>
        <pre className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed text-white/70">{d.citation.bibtex}</pre>
      </div>
    </div>
  );
}

function cellText(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 10 ? 3 : 4).replace(/0+$/, "");
  return String(v);
}

function Preview({ slug, total }: { slug: string; total: number }) {
  const [data, setData] = useState<PublicDatasetJsonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/public/datasets/${slug}?format=json&limit=${PREVIEW_ROWS}`, { cache: "no-store" });
        if (!res.ok) throw new Error("preview unavailable");
        const body = PublicDatasetJsonResponseSchema.parse(await res.json());
        if (alive) {
          setData(body);
          setError(null);
        }
      } catch {
        if (alive) setError("The preview is temporarily unavailable; downloads still work. It retries automatically.");
      }
    };
    void load();
    const t = setInterval(() => void load(), PREVIEW_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [slug]);

  return (
    <div className="mt-16">
      <div className="flex items-baseline justify-between border-b border-white/10 pb-3">
        <h3 className={`${HEAD} text-[11px] text-white/55`}>
          Live preview <span className="text-white/30">·</span> first {Math.min(PREVIEW_ROWS, total)} of {total} rows
        </h3>
        <span className={`${HEAD} flex items-center gap-2 text-[10px] text-white/55`}>
          <span className="size-1.5 animate-pulse rounded-full" style={{ background: ACCENT }} aria-hidden />
          Structured data
        </span>
      </div>
      {error && !data ? <p className="py-6 text-sm text-white/55">{error}</p> : null}
      {data && data.rows.length === 0 ? <p className="py-6 text-sm text-white/50">No verified observations yet.</p> : null}
      {data && data.rows.length > 0 ? (
        <div className="mt-2 max-h-[560px] overflow-auto border-x border-b border-white/10">
          <table className="w-max min-w-full border-collapse text-left font-mono text-[11px]">
            <thead className="sticky top-0 bg-black">
              <tr>
                {data.columns.map((c) => (
                  <th key={c} className="border-b border-white/15 px-3 py-2 font-normal whitespace-nowrap text-white/50">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={String(r.observation_id ?? i)} className="border-b border-white/5 hover:bg-white/[0.04]">
                  {data.columns.map((c) => (
                    <td key={c} className="px-3 py-1.5 whitespace-nowrap text-white/80 tabular-nums">
                      {cellText(r[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

const STEPS = [
  { n: "01", t: "Protocol", d: "A published protocol defines what to capture, safety rules, and the structured fields to extract." },
  { n: "02", t: "Guided capture", d: "The app guides the contributor live: framing checks, a timed burst challenge, and spoken field notes." },
  { n: "03", t: "8-layer verification", d: "Session integrity, server-side capture gate, subject relevance, quality, authenticity (incl. C2PA/AI labels), duplicates, context, protocol compliance and extraction sanity. Published only if a human approved it or the pipeline accepted it at confidence ≥ 0.75." },
  { n: "04", t: "Structured extraction", d: "Accepted captures become rows: model-estimated values with confidence, plus the contributor's own answers." },
  { n: "05", t: "Coarsening", d: "Before publishing: H3 cell-centre locations, 5-minute times, per-dataset pseudonyms. Photos never leave the private store." },
];

function Method() {
  return (
    <section id="method" className="border-t border-white/10">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-8 sm:py-28">
        <p className={`${HEAD} text-[11px] text-white/55`}>Method</p>
        <h2 className={`${HEAD} mt-3 text-3xl font-semibold tracking-[0.08em]! sm:text-5xl`}>How this data is made</h2>
        <ol className="mt-12 grid border-t border-white/15 sm:grid-cols-5">
          {STEPS.map((s) => (
            <li key={s.n} className="border-b border-white/15 py-6 sm:border-r sm:border-b-0 sm:px-5 sm:first:pl-0 sm:last:border-r-0">
              <span className="font-mono text-xs" style={{ color: ACCENT }}>
                {s.n}
              </span>
              <h3 className={`${HEAD} mt-3 text-sm font-semibold`}>{s.t}</h3>
              <p className="mt-3 text-sm leading-relaxed text-white/55">{s.d}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
