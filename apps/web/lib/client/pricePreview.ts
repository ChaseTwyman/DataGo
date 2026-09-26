/**
 * Form helpers for the data-request form. Prices are NOT computed here: the platform's pricing
 * engine runs only on the server (POST /api/pricing/preview), so its weights never ship to browsers.
 */

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
