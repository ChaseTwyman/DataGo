"use client";
import Link from "next/link";

/** /data crashed while rendering: same black open-data look, no technical detail. */
export default function DataError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-4 text-white" role="alert">
      <div className="max-w-md border-l-2 border-primary py-2 pl-6">
        <p className="text-[11px] caps text-white/50">Open data</p>
        <h1 className="mt-3 caps text-2xl font-semibold tracking-[0.08em]">Temporarily unavailable</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/60">
          This page hit a problem while loading. The data itself is unaffected — try again in a moment.
        </p>
        <div className="mt-6 flex gap-5 caps text-[11px]">
          <button type="button" onClick={() => retry()} className="cursor-pointer text-primary hover:text-white">
            Try again →
          </button>
          <Link href="/api/public/datasets" className="text-white/50 hover:text-white">
            Raw API
          </Link>
        </div>
        {error.digest ? <p className="mt-6 font-mono text-[10px] text-white/55">Reference {error.digest}</p> : null}
      </div>
    </main>
  );
}
