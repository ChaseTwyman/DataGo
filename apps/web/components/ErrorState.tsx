"use client";
import Link from "next/link";
import { useEffect } from "react";
import { buttonVariants, Button } from "./ui/button";

/**
 * Full-panel fallback for a crashed route segment (error.tsx). Never shows the error's message: in
 * production Next already redacts server errors, and client errors can carry internals. The digest
 * is shown so a report can be matched to server logs.
 */
export function SegmentError({ error, retry, home = "/bounties", homeLabel = "Back to bounties" }: { error: Error & { digest?: string }; retry: () => void; home?: string; homeLabel?: string }) {
  useEffect(() => {
    // Development aid only; production stays quiet in the console.
    if (process.env.NODE_ENV !== "production") console.info("[ui] segment error", error);
  }, [error]);
  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center p-6" role="alert">
      <div className="w-full max-w-md border-l-2 border-warning py-2 pl-6">
        <p className="caps text-[11px] text-muted-foreground">Error</p>
        <h1 className="caps mt-3 text-2xl font-semibold tracking-[0.08em]">Something went wrong</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">This page hit a problem while loading. Your data is safe — try again.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={() => retry()}>Try again</Button>
          <Link href={home} className={buttonVariants({ variant: "outline" })}>
            {homeLabel}
          </Link>
        </div>
        {error.digest ? <p className="mt-6 font-mono text-[11px] text-muted-foreground">Reference {error.digest}</p> : null}
      </div>
    </div>
  );
}

export function SegmentNotFound({ home = "/bounties", homeLabel = "Back to bounties" }: { home?: string; homeLabel?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md border-l-2 border-primary py-2 pl-6">
        <p className="caps text-[11px] text-muted-foreground">404</p>
        <h1 className="caps mt-3 text-2xl font-semibold tracking-[0.08em]">Page not found</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">That link doesn&apos;t point to anything here. It may have moved or been removed.</p>
        <div className="mt-6">
          <Link href={home} className={buttonVariants({ variant: "default" })}>
            {homeLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
