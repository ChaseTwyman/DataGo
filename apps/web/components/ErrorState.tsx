"use client";
import { CircleAlert, SearchX } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonVariants } from "./ui/button";

/**
 * Full-panel fallback for a crashed route segment (error.tsx) — dashboard look. Never shows the
 * error's message: in production Next already redacts server errors, and client errors can carry
 * internals. The digest is shown so a report can be matched to server logs.
 */
export function SegmentError({ error, retry, home = "/bounties", homeLabel = "Back to bounties" }: { error: Error & { digest?: string }; retry: () => void; home?: string; homeLabel?: string }) {
  useEffect(() => {
    // Development aid only; production stays quiet in the console.
    if (process.env.NODE_ENV !== "production") console.info("[ui] segment error", error);
  }, [error]);
  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center p-6" role="alert">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
        <CircleAlert className="mx-auto size-8 text-amber-500" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-1 text-sm text-muted-foreground">This page hit a problem while loading. Your data is safe — try again.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={() => retry()}>Try again</Button>
          <Link href={home} className={buttonVariants({ variant: "outline" })}>
            {homeLabel}
          </Link>
        </div>
        {error.digest ? <p className="mt-4 font-mono text-[11px] text-muted-foreground">Reference {error.digest}</p> : null}
      </div>
    </div>
  );
}

export function SegmentNotFound({ home = "/bounties", homeLabel = "Back to bounties" }: { home?: string; homeLabel?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
        <SearchX className="mx-auto size-8 text-muted-foreground" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold tracking-tight">Page not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">That link doesn&apos;t point to anything here. It may have moved or been removed.</p>
        <div className="mt-5 flex justify-center">
          <Link href={home} className={buttonVariants({ variant: "default" })}>
            {homeLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
