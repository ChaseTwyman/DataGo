"use client";
import Link from "next/link";

/** /data crashed while rendering: same black open-data look, no technical detail. */
export default function DataError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-4 text-white" role="alert">
      <div className="max-w-md border-l-2 border-sky-400 py-2 pl-6">
        <p className="text-[11px] tracking-[0.18em] text-white/50 uppercase">Open data</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-[0.08em] uppercase">Temporarily unavailable</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/60">
          This page hit a problem while loading. The data itself is unaffected — try again in a moment.
        </p>
        <div className="mt-6 flex gap-5 text-[11px] tracking-[0.18em] uppercase">
          <button type="button" onClick={() => retry()} className="cursor-pointer text-sky-300 hover:text-white">
            Try again →
          </button>
          <Link href="/api/public/datasets" className="text-white/50 hover:text-white">
            Raw API
          </Link>
        </div>
        {error.digest ? <p className="mt-6 font-mono text-[10px] text-white/30">Reference {error.digest}</p> : null}
      </div>
    </main>
  );
}
