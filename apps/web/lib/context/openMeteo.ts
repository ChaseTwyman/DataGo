/** Open-Meteo past precipitation (free, no key). PRD Appendix B. */
import { fetchJson } from "./fetcher";

interface OpenMeteoHourly {
  hourly?: { time?: number[]; precipitation?: (number | null)[] };
}

export function openMeteoUrl(lat: number, lng: number, lookbackHours: number): string {
  const pastDays = Math.min(92, Math.max(1, Math.ceil(lookbackHours / 24)));
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    `&hourly=precipitation&past_days=${pastDays}&forecast_days=1&timeformat=unixtime&timezone=GMT`
  );
}

/** Sum of hourly precipitation (mm) in the `lookbackHours` before `at` (inclusive of the current hour). */
export function sumPrecipitation(body: OpenMeteoHourly, at: Date, lookbackHours: number): number {
  const times = body.hourly?.time ?? [];
  const mm = body.hourly?.precipitation ?? [];
  const end = at.getTime() / 1000;
  const start = end - lookbackHours * 3600;
  let total = 0;
  times.forEach((t, i) => {
    // an hourly value covers the preceding hour; include hours ending in (start, end + 1h)
    if (t > start && t <= end + 3600) total += mm[i] ?? 0;
  });
  return Math.round(total * 10) / 10;
}

export async function pastPrecipitationMm(lat: number, lng: number, at: Date, lookbackHours: number): Promise<number> {
  const body = await fetchJson<OpenMeteoHourly>(openMeteoUrl(lat, lng, lookbackHours));
  return sumPrecipitation(body, at, lookbackHours);
}
