import { timeAgo } from "@/lib/client/cn";

/** Pure helpers behind the shell and time primitives (unit-tested in test/ds.test.ts). */

/** Future times read "in 3h"; past times "3h ago". */
export function relativeLabel(iso: string, now: number): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  if (t - now > 30_000) return `in ${timeAgo(new Date(now - (t - now)).toISOString(), now).replace(/ ago$/, "")}`;
  return timeAgo(iso, now);
}

/** Labels for breadcrumb segments; anything else is shown as-is (ids shortened). */
const SEGMENT_LABEL: Record<string, string> = {
  bounties: "Bounties",
  new: "New",
  live: "Live",
  review: "Review",
  datasets: "Datasets",
  "red-team": "Red team",
  protocols: "Protocols",
  studio: "Protocol Studio",
  radar: "Opportunity Radar",
  admin: "Admin",
  users: "Users",
  funding: "Funding",
  account: "Account",
};

export function breadcrumbs(pathname: string): { href: string; label: string }[] {
  const parts = pathname.split("/").filter(Boolean);
  return parts.map((p, i) => {
    const href = `/${parts.slice(0, i + 1).join("/")}`;
    const known = SEGMENT_LABEL[p];
    let label = known;
    if (!label) {
      let raw = p;
      try {
        raw = decodeURIComponent(p);
      } catch {
        // Malformed escape: show the raw segment.
      }
      label = /^[0-9a-f-]{16,}$/i.test(raw) ? `#${raw.slice(0, 8)}` : raw.replace(/-/g, " ");
    }
    return { href, label };
  });
}
