/** ?from&to for impact reports: ISO datetimes, default the last 90 days, at most 366 days. */
import { IsoDate } from "@groundtruth/shared";
import { z } from "zod";
import { badRequest } from "../api/http";

const PeriodQuery = z.object({ from: IsoDate.optional(), to: IsoDate.optional() });

export function parsePeriod(req: Request, now = new Date()): { from: string; to: string } {
  const q = PeriodQuery.parse(Object.fromEntries(new URL(req.url).searchParams.entries()));
  const to = q.to ? new Date(q.to) : now;
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 90 * 86_400_000);
  if (from.getTime() >= to.getTime()) throw badRequest("`from` must be before `to`");
  if (to.getTime() - from.getTime() > 366 * 86_400_000) throw badRequest("The period can be at most 366 days");
  return { from: from.toISOString(), to: to.toISOString() };
}
