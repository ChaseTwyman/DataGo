import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Mark } from "./Mark";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Split layout for /login and /reset-password: brand panel on the left (hidden below md), the form
 * column on the right.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative grid min-h-screen bg-background md:grid-cols-[minmax(0,1.1fr)_minmax(420px,1fr)]">
      <div className="absolute top-4 right-4 z-10 md:top-6 md:right-6">
        <ThemeToggle />
      </div>
      <section className="relative hidden flex-col justify-between overflow-hidden border-r p-10 md:flex lg:p-14">
        <HexGrid />
        <div className="relative flex items-center gap-3">
          <Mark className="size-7" />
          <span className="caps text-sm font-semibold tracking-[0.34em]">GroundTruth</span>
        </div>
        <div className="relative max-w-lg">
          <p className="caps text-[11px] text-muted-foreground">
            Field data <span className="text-primary">·</span> Verified <span className="text-primary">·</span> Open
          </p>
          <h1 className="caps mt-5 text-5xl leading-[1.02] font-semibold tracking-[0.06em] lg:text-6xl">
            A bounty board
            <br />
            for reality.
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-muted-foreground">
            Sponsors fund the places that need eyes. People on the ground capture them. Every observation is verified before it
            counts, and every structured row is published for science.
          </p>
        </div>
        <Link href="/data" className="caps group relative inline-flex w-fit items-center gap-2 text-[11px] text-muted-foreground hover:text-foreground">
          Browse open data — free, no login
          <ArrowRight className="size-3.5 text-primary transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      </section>
      <section className="flex min-h-screen flex-col px-6 py-10 sm:px-12">
        <div className="flex items-center gap-3 md:hidden">
          <Mark className="size-6" />
          <span className="caps text-sm font-semibold tracking-[0.32em]">GroundTruth</span>
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <p className="caps text-center text-[10px] text-muted-foreground md:hidden">
          <Link href="/data" className="hover:text-foreground">
            Browse open data →
          </Link>
        </p>
      </section>
    </main>
  );
}

/** Faint hexagon lattice behind the brand panel (decorative). */
function HexGrid() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.07]" aria-hidden>
      <defs>
        <pattern id="gt-hex" width="56" height="97" patternUnits="userSpaceOnUse" patternTransform="scale(1.1)">
          <path d="M28 0 L56 16.2 L56 48.5 L28 64.7 L0 48.5 L0 16.2 Z M28 64.7 L28 97" fill="none" stroke="currentColor" strokeWidth="1" />
        </pattern>
        <linearGradient id="gt-hex-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id="gt-hex-mask">
          <rect width="100%" height="100%" fill="url(#gt-hex-fade)" />
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="url(#gt-hex)" mask="url(#gt-hex-mask)" />
    </svg>
  );
}

/** Title block at the top of an auth form. */
export function AuthHeading({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-7">
      {eyebrow ? <p className="caps text-[11px] text-muted-foreground">{eyebrow}</p> : null}
      <h2 className="caps mt-2 text-3xl font-semibold tracking-[0.08em]">{title}</h2>
      {children ? <div className="mt-3 text-sm leading-relaxed text-muted-foreground">{children}</div> : null}
    </div>
  );
}
