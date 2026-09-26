"use client";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { formatCents, PublicFundingResponseSchema, type PublicFundingResponse } from "@groundtruth/shared";
import { Mark } from "@/components/ds/Mark";

/**
 * /funding — public transparency: who sponsors GroundTruth and where the pool stands. Same black
 * aesthetic as /data. Aggregates only: no per-user or per-request data.
 */
const ACCENT = "#38bdf8";
const HEAD = "font-[family-name:var(--font-condensed)] uppercase tracking-[0.18em]";
const REFRESH_MS = 60_000;

export function PublicFundingPage() {
  const [data, setData] = useState<PublicFundingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/public/funding", { cache: "no-store" });
        if (!res.ok) throw new Error("unavailable");
        const body = PublicFundingResponseSchema.parse(await res.json());
        if (alive) {
          setData(body);
          setError(null);
        }
      } catch {
        if (alive) setError("Funding figures are temporarily unavailable. The page retries automatically.");
      }
    };
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="min-h-screen bg-black text-white antialiased">
      <header className="border-b border-white/10">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-8">
          <Link href="/data" className={`${HEAD} flex items-center gap-2.5 text-sm font-semibold tracking-[0.35em]!`}>
            <Mark className="size-6" />
            GroundTruth
          </Link>
          <nav className={`${HEAD} flex items-center gap-5 text-[11px] text-white/60 sm:gap-8`}>
            <Link href="/data" className="hover:text-white">Open data</Link>
            <Link href="/login" className="hover:text-white">Researchers</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-20 pb-24 sm:px-8 sm:pt-28">
        <p className={`${HEAD} text-[11px] text-white/50`}>
          Sponsor pool <span style={{ color: ACCENT }}>·</span> Transparency
        </p>
        <h1 className={`${HEAD} mt-6 text-4xl leading-[1.05] font-semibold tracking-[0.06em]! sm:text-6xl`}>Who funds the data.</h1>
        <p className="mt-8 max-w-2xl text-base leading-relaxed text-white/65 sm:text-lg">
          Sponsors contribute to one pool. Researchers request the data they need; GroundTruth funds requests from the pool and sets
          every price with its own pricing engine. Contributors are paid for verified observations, and the data is free for everyone.
          Figures are simulated during the pilot.
        </p>
        {error ? <p className={`${HEAD} mt-10 text-[11px] text-white/55`}>{error}</p> : null}
        {data ? (
          <>
            <dl className="mt-14 grid grid-cols-2 border-t border-white/15 sm:grid-cols-4">
              <Figure label="Contributed" value={formatCents(data.totals.contributed_cents)} />
              <Figure label="Allocated to requests" value={formatCents(data.totals.allocated_cents)} />
              <Figure label="Paid to contributors" value={formatCents(data.totals.paid_cents)} />
              <Figure label="Available" value={<span style={{ color: ACCENT }}>{formatCents(data.totals.available_cents)}</span>} />
            </dl>
            <p className={`${HEAD} mt-6 text-[10px] text-white/45`}>
              {data.requests.active} funded requests live · {data.requests.pending} awaiting funding
            </p>
            <section className="mt-20 border-t border-white/10 pt-10">
              <h2 className={`${HEAD} text-[11px] text-white/55`}>Sponsors</h2>
              {data.sponsors.length === 0 ? (
                <p className="mt-6 text-white/55">No sponsors yet.</p>
              ) : (
                <ul className="mt-6 divide-y divide-white/10 border-y border-white/10">
                  {data.sponsors.map((s) => (
                    <li key={s.name} className="flex items-center justify-between gap-4 py-4">
                      <span className="flex min-w-0 items-center gap-3">
                        {s.logo_url ? (
                          <img src={s.logo_url} alt="" className="size-7 shrink-0 object-contain" />
                        ) : null}
                        {s.url ? (
                          <a href={s.url} target="_blank" rel="noreferrer noopener" className="truncate hover:underline">
                            {s.name}
                          </a>
                        ) : (
                          <span className="truncate">{s.name}</span>
                        )}
                      </span>
                      <span className="text-white/65 tabular-nums">{formatCents(s.contributed_cents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </main>
      <footer className="border-t border-white/10">
        <div className="mx-auto max-w-6xl px-4 py-10 text-xs text-white/55 sm:px-8">
          API: <code className="text-white/60">GET /api/public/funding</code>
        </div>
      </footer>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border-b border-white/15 py-5 pr-4 sm:border-r sm:border-b-0 sm:px-5 sm:first:pl-0 sm:last:border-r-0">
      <dt className={`${HEAD} text-[10px] text-white/55`}>{label}</dt>
      <dd className="mt-2 text-2xl font-light tabular-nums sm:text-3xl">{value}</dd>
    </div>
  );
}
