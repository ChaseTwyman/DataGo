"use client";
import {
  ClipboardCheck,
  Database,
  Globe,
  FlaskConical,
  Hexagon,
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
import type { ReactNode } from "react";
import { useHealth } from "@/lib/client/health";
import { useMe } from "@/lib/client/me";
import type { StoredSession } from "@/lib/client/session";
import { chooseStreamMode } from "@/lib/client/stream";
import { supabaseConfigured } from "@/lib/supabase/browser";
import { cn } from "@/lib/client/cn";

const NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/bounties", label: "Bounties", icon: MapIcon },
  { href: "/live", label: "Live", icon: Radio },
  { href: "/review", label: "Review", icon: ClipboardCheck },
  { href: "/datasets", label: "Datasets", icon: Database },
  { href: "/red-team", label: "Red team", icon: Swords },
];
const RESEARCH = [
  { href: "/protocols", label: "Protocols", icon: FlaskConical },
  { href: "/studio", label: "Protocol Studio", icon: Sparkles },
  { href: "/radar", label: "Opportunity Radar", icon: Radar },
];
const ADMIN = [{ href: "/admin/users", label: "Users", icon: Users }];
const ALWAYS = [
  { href: "/account", label: "Account", icon: UserRound },
  { href: "/data", label: "Open data", icon: Globe },
];

export function Sidebar({ session, onSignOut }: { session: StoredSession; onSignOut: () => void }) {
  const pathname = usePathname();
  const { state, data } = useHealth();
  const mode = chooseStreamMode(state, supabaseConfigured());
  const { me } = useMe();
  const researcher = me?.is_researcher ?? false;
  const roleLabel = me ? [me.is_admin ? "Admin" : null, me.is_researcher ? "Researcher" : null, "Contributor"].filter(Boolean).join(" · ") : "";

  const item = (n: { href: string; label: string; icon: LucideIcon }) => {
    const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
    const Icon = n.icon;
    return (
      <Link
        key={n.href}
        href={n.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
          active ? "bg-white/12 text-white" : "text-rail-foreground/75 hover:bg-white/6 hover:text-white",
        )}
      >
        <Icon className="size-4" aria-hidden />
        {n.label}
      </Link>
    );
  };

  return (
    <aside className="flex w-56 shrink-0 flex-col bg-rail text-rail-foreground">
      <Link href="/bounties" className="flex items-center gap-2 px-5 pt-5 pb-6">
        <span className="flex size-8 items-center justify-center rounded-lg bg-sky-500 text-white">
          <Hexagon className="size-5" aria-hidden />
        </span>
        <span>
          <span className="block text-sm font-semibold text-white">GroundTruth</span>
          <span className="block text-[11px] text-rail-foreground/60">Researcher console</span>
        </span>
      </Link>
      <nav className="flex flex-col gap-0.5 px-3" aria-label="Main">
        {researcher ? NAV.map(item) : null}
        {researcher ? <div className="my-3 border-t border-white/10" /> : null}
        {researcher ? RESEARCH.map(item) : null}
        {me?.is_admin ? ADMIN.map(item) : null}
        {researcher || me?.is_admin ? <div className="my-3 border-t border-white/10" /> : null}
        {ALWAYS.map(item)}
      </nav>
      <div className="mt-auto space-y-3 p-4 text-[11px]">
        <div className="flex flex-wrap gap-1">
          {data ? (
            <>
              <Chip on>{data.backend === "local" ? "Local backend" : "Supabase"}</Chip>
              {data.mock_grok ? <Chip warn>Mock Grok</Chip> : <Chip on>Live Grok</Chip>}
              {data.demo_mode ? <Chip warn>Demo mode</Chip> : null}
            </>
          ) : state.status === "error" ? (
            <Chip warn>API unreachable</Chip>
          ) : null}
          {mode ? <Chip on>{mode === "realtime" ? "Realtime" : "Polling 2s"}</Chip> : null}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-white/10 pt-3">
          <div className="min-w-0">
            <div className="truncate text-rail-foreground">{me?.display_name ?? me?.email ?? session.email ?? "Signed in"}</div>
            <div className="truncate text-rail-foreground/50">{roleLabel}</div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="flex size-9 cursor-pointer items-center justify-center rounded-md text-rail-foreground/70 hover:bg-white/10 hover:text-white"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </aside>
  );
}

function Chip({ children, on, warn }: { children: ReactNode; on?: boolean; warn?: boolean }) {
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5",
        warn ? "border-amber-400/40 text-amber-200" : on ? "border-white/20 text-rail-foreground/80" : "border-white/10",
      )}
    >
      {children}
    </span>
  );
}
