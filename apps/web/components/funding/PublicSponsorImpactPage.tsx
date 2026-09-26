"use client";
import Link from "next/link";
import { useState } from "react";
import { Tabs } from "@/components/ds/controls";
import { Mark } from "@/components/ds/Mark";
import { GrokbotErrorNotice, GrokbotSkeleton } from "@/components/grokbot/GrokbotCard";
import { ImpactBody } from "@/components/grokbot/SponsorImpact";
import { api } from "@/lib/client/api";
import { IMPACT_PERIODS, impactRange, type ImpactPeriod } from "@/lib/client/grokbot";
import { useGrokbot } from "@/lib/client/useGrokbot";

const HEAD = "font-[family-name:var(--font-condensed)] uppercase tracking-[0.18em]";

/**
 * /funding/sponsors/[id] — public, aggregate-only impact of one sponsor (no login). Same black
 * aesthetic as /funding. Never names or locates individual contributors (server guarantees it; this
 * page only renders the aggregate fields of the contract).
 */
export function PublicSponsorImpactPage({ sponsorId }: { sponsorId: string }) {
  const [period, setPeriod] = useState<ImpactPeriod>("all");
  const g = useGrokbot(() => api.publicSponsorImpact(sponsorId, impactRange(period)), `public-impact:${sponsorId}:${period}`);
  return (
    <div className="min-h-screen bg-black text-white antialiased">
      <header className="border-b border-white/10">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-8">
          <Link href="/data" className={`${HEAD} flex items-center gap-2.5 text-sm font-semibold tracking-[0.35em]!`}>
            <Mark className="size-6" />
            GroundTruth
          </Link>
          <nav className={`${HEAD} flex items-center gap-5 text-[11px] text-white/60 sm:gap-8`}>
            <Link href="/funding" className="hover:text-white">
              Funding
            </Link>
            <Link href="/data" className="hover:text-white">
              Open data
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-16 pb-24 sm:px-8 sm:pt-24">
        <p className={`${HEAD} text-[11px] text-white/50`}>Sponsor impact</p>
        <h1 className={`${HEAD} mt-6 text-4xl leading-[1.05] font-semibold tracking-[0.06em]! sm:text-5xl`}>{g.data?.sponsor_name ?? "Impact report"}</h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-white/65">
          What this sponsor&apos;s contributions paid for: verified observations, map coverage and funded data requests. Aggregates only;
          figures are simulated during the pilot.
        </p>
        <div className="mt-10">
          <Tabs label="Report period" size="sm" items={IMPACT_PERIODS} value={period} onChange={setPeriod} />
        </div>
        <div className="mt-8 max-w-4xl space-y-4">
          {g.error ? <GrokbotErrorNotice error={g.error} onRetry={() => void g.load(false)} /> : null}
          {g.loading && !g.data ? <GrokbotSkeleton label="Loading the report…" /> : null}
          {g.data ? <ImpactBody r={g.data} dim={g.loading} /> : null}
        </div>
        <p className="mt-16">
          <Link href="/funding" className={`${HEAD} text-[11px] text-white/60 hover:text-white`}>
            <span aria-hidden>←</span> All sponsors
          </Link>
        </p>
      </main>
    </div>
  );
}
