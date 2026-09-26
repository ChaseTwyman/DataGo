/** ?from&to for impact reports: optional ISO datetimes. No `from` = all time; no `to` = now. */
import { IsoDate } from "@groundtruth/shared";
import { z } from "zod";
import { badRequest } from "../api/http";

const PeriodQuery = z.object({ from: IsoDate.optional(), to: IsoDate.optional() });

export interface Period {
  /** null = all time (the report starts at the sponsor's creation). */
  from: string | null;
  to: string;
}

export function parsePeriod(req: Request, now = new Date()): Period {
  const q = PeriodQuery.parse(Object.fromEntries(new URL(req.url).searchParams.entries()));
  const to = q.to ? new Date(q.to) : now;
  const from = q.from ? new Date(q.from) : null;
  if (from && from.getTime() >= to.getTime()) throw badRequest("`from` must be before `to`");
  return { from: from ? from.toISOString() : null, to: to.toISOString() };
}
