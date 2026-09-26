/** Live price preview for the create-bounty form: every cell is empty at creation time. */
import { computePrice, hoursBetween, type CellPrice } from "@groundtruth/shared";

export interface PreviewInput {
  cells: string[];
  baseCents: number;
  maxCents: number;
  targetPerCell: number;
  priority: number;
  tauHours: number;
  /** ISO string or null when the bounty has no triggering event. */
  eventStartedAt: string | null;
  now?: Date;
}

export interface PricePreview {
  cells: CellPrice[];
  priceCents: number;
  surge: number;
  /** Cost if every cell reached target at today's (max) price — an upper bound on exposure. */
  maxExposureCents: number;
}

export function previewPrices(input: PreviewInput): PricePreview {
  const now = input.now ?? new Date();
  const hours = input.eventStartedAt ? Math.max(0, hoursBetween(input.eventStartedAt, now)) : null;
  const base = Math.max(1, Math.round(input.baseCents || 0));
  const target = Math.max(1, Math.round(input.targetPerCell || 1));
  const p = computePrice({
    baseCents: base,
    maxCents: Math.round(input.maxCents || 0),
    acceptedInCell: 0,
    targetPerCell: target,
    hoursSinceEventStart: hours,
    tauHours: input.tauHours,
    priority: input.priority,
  });
  const cells: CellPrice[] = input.cells.map((cell) => ({
    cell,
    accepted: 0,
    target,
    price_cents: p.priceCents,
    surge: p.surge,
    paused: false,
    paused_reason: null,
  }));
  return {
    cells,
    priceCents: p.priceCents,
    surge: p.surge,
    maxExposureCents: input.cells.length * target * p.priceCents,
  };
}

/** Parse a dollars text field ("2", "2.50", "$4") into integer cents; NaN when invalid. */
export function dollarsToCents(text: string): number {
  const v = Number(text.replace(/[$,\s]/g, ""));
  return Number.isFinite(v) ? Math.round(v * 100) : Number.NaN;
}

/** `<input type="datetime-local">` value ↔ ISO with offset. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function isoToLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
