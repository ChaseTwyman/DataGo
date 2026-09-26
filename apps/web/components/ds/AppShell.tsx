"use client";
import {
  ChevronRight,
  ClipboardCheck,
  Coins,
  Database,
  FlaskConical,
  Globe,
  LogOut,
  Map as MapIcon,
  Radar,
  Radio,
  Sparkles,
  Swords,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useHealth } from "@/lib/client/health";
import { useMe } from "@/lib/client/me";
import type { StoredSession } from "@/lib/client/session";
import { chooseStreamMode } from "@/lib/client/stream";
import { supabaseConfigured } from "@/lib/supabase/browser";
import { cn } from "@/lib/client/cn";
import { breadcrumbs } from "./format";
import { Mark } from "./Mark";

type NavItem = { href: string; label: string; icon: LucideIcon };

const OPERATIONS: NavItem[] = [
  { href: "/bounties", label: "Bounties", icon: MapIcon },
  { href: "/live", label: "Live", icon: Radio },
  { href: "/review", label: "Review", icon: ClipboardCheck },
  { href: "/datasets", label: "Datasets", icon: Database },
  { href: "/red-team", label: "Red team", icon: Swords },
];
const RESEARCH: NavItem[] = [
  { href: "/protocols", label: "Protocols", icon: FlaskConical },
  { href: "/studio", label: "Protocol Studio", icon: Sparkles },
  { href: "/radar", label: "Opportunity Radar", icon: Radar },
];
const ADMIN: NavItem[] = [
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/funding", label: "Funding", icon: Coins },
];
const ALWAYS: NavItem[] = [
  { href: "/account", label: "Account", icon: UserRound },
  { href: "/data", label: "Open data", icon: Globe },
];

/**
 * Dashboard frame: slim left rail (mark, caps nav, accent bar on the active item; icon-only below
 * lg) and a top bar with the breadcrumb, system status and the account menu.
 */
export function AppShell({ session, onSignOut, children }: { session: StoredSession; onSignOut: () => void; children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Rail />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar session={session} onSignOut={onSignOut} />
        <main id="main" className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

function Rail() {
  const pathname = usePathname();
  const { me } = useMe();
  const researcher = me?.is_researcher ?? false;

  const groups: { label: string; items: NavItem[] }[] = [
    ...(researcher ? [{ label: "Operations", items: OPERATIONS }, { label: "Research", items: RESEARCH }] : []),
    ...(me?.is_admin ? [{ label: "Admin", items: ADMIN }] : []),
    { label: "General", items: ALWAYS },
  ];

  return (
    <aside className="flex w-14 shrink-0 flex-col border-r bg-rail text-rail-foreground lg:w-56">
      <Link
        href="/bounties"
        className="flex h-14 shrink-0 items-center gap-3 border-b px-4 lg:px-5"
        aria-label="GroundTruth — bounties"
      >
        <Mark className="size-6 shrink-0" />
        <span className="hidden min-w-0 lg:block">
          <span className="caps block text-[13px] leading-none font-semibold tracking-[0.3em]">GroundTruth</span>
          <span className="caps mt-1 block text-[9px] leading-none tracking-[0.22em] text-muted-foreground">Researcher console</span>
        </span>
      </Link>
      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto py-4" aria-label="Main">
        {groups.map((g) => (
          <div key={g.label} className="flex flex-col">
            <div className="caps mb-1.5 hidden px-5 text-[9px] tracking-[0.24em] text-muted-foreground lg:block">{g.label}</div>
            <div className="mx-3 mb-1.5 border-t lg:hidden" aria-hidden />
            {g.items.map((n) => {
              const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
              const Icon = n.icon;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  title={n.label}
                  className={cn(
                    "caps relative flex h-9 items-center justify-center gap-3 text-xs tracking-[0.14em] transition-colors lg:justify-start lg:px-5",
                    active ? "bg-white/[0.05] text-foreground" : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground",
                  )}
                >
                  <span className={cn("absolute inset-y-1.5 left-0 w-0.5", active ? "bg-primary" : "bg-transparent")} aria-hidden />
                  <Icon className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
                  <span className="hidden truncate lg:inline">{n.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function TopBar({ session, onSignOut }: { session: StoredSession; onSignOut: () => void }) {
  const pathname = usePathname();
  const crumbs = breadcrumbs(pathname);
  // Dashboard pages are client components (no per-page metadata export): title from the breadcrumb.
  const pageTitle = crumbs.map((c) => c.label).reverse().join(" · ");
  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} · GroundTruth` : "GroundTruth";
  }, [pageTitle]);
  return (
    <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6">
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="caps flex min-w-0 items-center gap-1.5 text-[11px] tracking-[0.18em]">
          {crumbs.map((c, i) => (
            <Fragment key={c.href}>
              {i ? <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" aria-hidden /> : null}
              <li className="min-w-0 truncate">
                {i === crumbs.length - 1 ? (
                  <span aria-current="page" className="text-foreground">
                    {c.label}
                  </span>
                ) : (
                  <Link href={c.href} className="text-muted-foreground hover:text-foreground">
                    {c.label}
                  </Link>
                )}
              </li>
            </Fragment>
          ))}
        </ol>
      </nav>
      <div className="flex shrink-0 items-center gap-5">
        <SystemStatus />
        <AccountMenu session={session} onSignOut={onSignOut} />
      </div>
    </div>
  );
}

/** Backend / model / stream telemetry. Amber marks anything that isn't production-real. */
function SystemStatus() {
  const { state, data } = useHealth();
  const mode = chooseStreamMode(state, supabaseConfigured());
  const items: { label: string; value: string; warn?: boolean }[] = [];
  if (data) {
    items.push({ label: "Backend", value: data.backend === "local" ? "Local" : "Supabase" });
    items.push({ label: "Grok", value: data.mock_grok ? "Mock" : "Live", warn: data.mock_grok });
    if (data.demo_mode) items.push({ label: "Mode", value: "Demo", warn: true });
  } else if (state.status === "error") {
    items.push({ label: "API", value: "Unreachable", warn: true });
  }
  if (mode) items.push({ label: "Stream", value: mode === "realtime" ? "Realtime" : "Polling 2s" });
  if (!items.length) return null;
  return (
    <ul className="caps hidden items-center gap-4 text-[10px] tracking-[0.16em] md:flex" aria-label="System status">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", it.warn ? "bg-warning" : "bg-success")} aria-hidden />
          <span className="text-muted-foreground">{it.label}</span>
          <span className={it.warn ? "text-warning" : "text-foreground"}>{it.value}</span>
        </li>
      ))}
    </ul>
  );
}

function AccountMenu({ session, onSignOut }: { session: StoredSession; onSignOut: () => void }) {
  const { me } = useMe();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const name = me?.display_name ?? me?.email ?? session.email ?? "Signed in";
  const roleLabel = me ? [me.is_admin ? "Admin" : null, me.is_researcher ? "Researcher" : null, "Contributor"].filter(Boolean).join(" · ") : "";
  const initials =
    name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "·";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
       
        aria-expanded={open}
        className="flex h-9 cursor-pointer items-center gap-2.5 rounded-sm px-1.5 hover:bg-accent"
      >
        <span className="caps flex size-7 items-center justify-center rounded-[2px] border border-input text-[11px] font-semibold tracking-[0.06em]">
          {initials}
        </span>
        <span className="hidden max-w-40 truncate text-sm xl:inline">{name}</span>
      </button>
      {open ? (
        <div className="absolute top-11 right-0 z-40 w-64 rounded-sm border bg-popover shadow-lg">
          <div className="border-b px-4 py-3">
            <div className="truncate text-sm">{name}</div>
            {me?.email && me.email !== name ? <div className="truncate text-xs text-muted-foreground">{me.email}</div> : null}
            {roleLabel ? <div className="caps mt-1.5 text-[10px] text-muted-foreground">{roleLabel}</div> : null}
          </div>
          <div className="py-1">
            <MenuLink href="/account" icon={UserRound}>
              Account
            </MenuLink>
            <MenuLink href="/data" icon={Globe}>
              Open data
            </MenuLink>
          </div>
          <div className="border-t py-1">
            <button
              type="button"
             
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              className="caps flex h-9 w-full cursor-pointer items-center gap-3 px-4 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <LogOut className="size-4" strokeWidth={1.5} aria-hidden /> Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({ href, icon: Icon, children }: { href: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <Link href={href} className="caps flex h-9 items-center gap-3 px-4 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
      <Icon className="size-4" strokeWidth={1.5} aria-hidden /> {children}
    </Link>
  );
}
