import { stageLabel, type LenientStageResult as StageResult } from "@groundtruth/shared";
import { formatMs, formatScore, orderedChecks } from "@/lib/client/checkFormat";
import { ReasonCode, StageStatusBadge } from "../status";

/** Per-stage verification results (PRD §9.2): status, score, reason codes, evidence, subchecks, ms. */
export function CheckTable({ checks, fillMissing = true }: { checks: StageResult[]; fillMissing?: boolean }) {
  const rows = fillMissing ? orderedChecks(checks) : checks;
  return (
    <div className="overflow-x-auto rounded-sm border">
      <table className="w-full text-xs">
        <thead className="caps border-b text-[10px] text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">Stage</th>
            <th className="px-2 py-1.5 text-left font-medium">Status</th>
            <th className="px-2 py-1.5 text-right font-medium">Score</th>
            <th className="px-2 py-1.5 text-left font-medium">Reasons &amp; evidence</th>
            <th className="px-2 py-1.5 text-right font-medium">Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.stage} className="border-t align-top">
              <td className="px-2 py-1.5 font-medium whitespace-nowrap">{stageLabel(c.stage, c.label)}</td>
              <td className="px-2 py-1.5">
                <StageStatusBadge status={c.status} />
              </td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums">{formatScore(c.score)}</td>
              <td className="px-2 py-1.5">
                {c.reasonCodes.length ? (
                  <div className="mb-1 flex flex-wrap gap-1">
                    {c.reasonCodes.map((r) => (
                      <ReasonCode key={r} code={r} />
                    ))}
                  </div>
                ) : null}
                {c.evidence.length ? (
                  <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                    {c.evidence.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                ) : null}
                {c.subchecks?.length ? (
                  <ul className="mt-1 space-y-1 border-l-2 pl-2">
                    {c.subchecks.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-1.5">
                        <StageStatusBadge status={s.status} />
                        <span className="font-medium">{s.label}</span>
                        {s.detail ? <span className="text-muted-foreground">— {s.detail}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {!c.reasonCodes.length && !c.evidence.length && !c.subchecks?.length ? (
                  <span className="text-muted-foreground">—</span>
                ) : null}
              </td>
              <td className="px-2 py-1.5 text-right font-mono whitespace-nowrap text-muted-foreground tabular-nums">
                {formatMs(c.ms)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
