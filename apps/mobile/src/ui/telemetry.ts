/**
 * Telemetry-style readout formatters ("T+00:14", "SURGE ×5.0", "2H 14M"). Pure, no React Native
 * imports, unit-tested in test/ui.test.ts.
 */
import { formatCents, formatSurge } from "@groundtruth/shared";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Mission-elapsed time: T+MM:SS, or T+H:MM:SS past an hour. */
export function tPlus(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `T+${h}:${pad2(m)}:${pad2(s)}` : `T+${pad2(m)}:${pad2(s)}`;
}

/** Challenge countdown: T-2, T-1, T-0. */
export function countdownLabel(seconds: number): string {
  return `T-${Math.max(0, Math.ceil(seconds))}`;
}

export function surgeTag(surge: number): string {
  return `SURGE ${formatSurge(surge)}`;
}

/** Distance as a value + unit pair so the number can be set large and the unit small. */
export function distanceReadout(m: number): { value: string; unit: string } {
  if (m < 50) return { value: "HERE", unit: "" };
  if (m < 1000) return { value: String(Math.round(m / 10) * 10), unit: "M" };
  return { value: (m / 1000).toFixed(1), unit: "KM" };
}

export function timeLeftReadout(endsAt: string, now = Date.now()): string {
  const ms = new Date(endsAt).getTime() - now;
  if (ms <= 0) return "ENDED";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}M`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}H ${min % 60}M`;
  return `${Math.floor(h / 24)}D`;
}

/** "$11.60" → { major: "$11", minor: ".60" } so cents can be set smaller than dollars. */
export function moneyParts(cents: number): { major: string; minor: string } {
  const s = formatCents(Math.abs(cents));
  const dot = s.lastIndexOf(".");
  const sign = cents < 0 ? "−" : "";
  return { major: sign + s.slice(0, dot), minor: s.slice(dot) };
}

/** Sponsor attribution for bounty cards and the briefing; null hides the line. */
export function sponsorLine(name: string | null | undefined): string | null {
  const n = name?.trim();
  return n ? `FUNDED BY ${n.toUpperCase()} · DATA FREE FOR EVERYONE` : null;
}

/** Zero-padded 1-based list index: 0 → "01". */
export function indexLabel(i: number): string {
  return pad2(i + 1);
}
