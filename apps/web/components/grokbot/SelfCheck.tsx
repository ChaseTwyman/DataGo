"use client";
import { CircleCheck, LoaderCircle, ScanSearch, TriangleAlert } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/client/api";
import {
  clearSelfCheck,
  getSelfCheck,
  selfCheckSnapshot,
  selfCheckStage,
  startSelfCheck,
  subscribeSelfChecks,
  verdictMeta,
  type SelfCheckJob,
} from "@/lib/client/grokbot";
import { JobProgress, Panel, PanelHeader } from "../ds/primitives";
import { SyntheticImage } from "../SyntheticImage";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Table, TBody, TD, TH, THead, TR } from "../ui/table";
import { GrokbotErrorNotice, GrokbotProvenance } from "./GrokbotCard";

const EXPECTED_MS = 60_000;

/** The current self-check job for a protocol (survives leaving the Studio page). */
export function useSelfCheck(protocolId: string): SelfCheckJob | null {
  useSyncExternalStore(subscribeSelfChecks, selfCheckSnapshot, selfCheckSnapshot);
  return getSelfCheck(protocolId);
}

/**
 * Studio "Self-check with Grok": runs the saved draft's example image through the live frame check
 * and relevance models, then shows a per-element verdict table. Advisory only: Publish stays enabled.
 */
export function SelfCheckStep({ protocolId, dirty }: { protocolId: string; dirty: boolean }) {
  const job = useSelfCheck(protocolId);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (job?.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job?.status]);
  const running = job?.status === "running";
  const run = () => startSelfCheck(protocolId, (id) => api.grokbotSelfCheck(id));

  return (
    <Panel>
      <PanelHeader
        title="Self-check with Grok"
        icon={ScanSearch}
        actions={
          job?.status === "done" ? (
            <Badge tone={job.result.overall === "ready" ? "success" : job.result.overall === "revise" ? "warning" : "muted"}>
              {job.result.overall === "ready" ? <CircleCheck aria-hidden /> : <TriangleAlert aria-hidden />}
              {job.result.overall === "ready" ? "Ready" : job.result.overall === "revise" ? "Revise" : job.result.overall}
            </Badge>
          ) : null
        }
      />
      <div className="space-y-4 p-4 text-sm">
        <p className="text-muted-foreground">
          Before publishing, Grok runs this protocol&apos;s example image through the same live checks contributors&apos; cameras use and reports
          which required elements it can detect. It&apos;s advice: you decide whether to publish.
          {dirty ? " It checks the saved draft; edits you haven't published yet aren't included." : ""}
        </p>
        {running ? (
          <JobProgress stage={selfCheckStage(now - job.startedAt)} pct={Math.min(95, ((now - job.startedAt) / EXPECTED_MS) * 100)}>
            {Math.round(Math.max(0, now - job.startedAt) / 1000)} s · usually 30–60 seconds. You can leave this page; the result will be here
            when you come back.
          </JobProgress>
        ) : null}
        {job?.status === "error" ? <GrokbotErrorNotice error={job.error} onRetry={run} /> : null}
        {job?.status === "done" ? <SelfCheckResult job={job} /> : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={run} disabled={running}>
            {running ? <LoaderCircle className="animate-spin" aria-hidden /> : <ScanSearch aria-hidden />}
            {running ? "Checking…" : job?.status === "done" ? "Check again" : "Self-check with Grok"}
          </Button>
          {job && !running ? (
            <Button variant="ghost" size="sm" onClick={() => clearSelfCheck(protocolId)}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function SelfCheckResult({ job }: { job: Extract<SelfCheckJob, { status: "done" }> }) {
  const r = job.result;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
        <div className="min-w-0">
          {r.elements.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>Required element</TH>
                  <TH>Camera</TH>
                  <TH className="text-right">Confidence</TH>
                  <TH>Suggestion</TH>
                </TR>
              </THead>
              <TBody>
                {r.elements.map((e) => {
                  const v = verdictMeta(e.verdict);
                  return (
                    <TR key={e.id}>
                      <TD className="font-medium">{e.label}</TD>
                      <TD>
                        <Badge tone={v.tone}>{v.label}</Badge>
                      </TD>
                      <TD className="text-right tabular-nums">{e.confidence === null ? "—" : `${Math.round(e.confidence * 100)}%`}</TD>
                      <TD className="text-xs text-muted-foreground">{e.suggestion ?? ""}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          ) : (
            <p className="text-xs text-muted-foreground">Grok returned no per-element results.</p>
          )}
          {r.relevance_ok !== null ? (
            <p className="mt-2 flex items-center gap-2 text-xs">
              {r.relevance_ok ? <CircleCheck className="size-3.5 text-success" aria-hidden /> : <TriangleAlert className="size-3.5 text-warning" aria-hidden />}
              {r.relevance_ok ? "The example is recognized as this protocol's subject." : "The example may not be recognized as this protocol's subject."}
            </p>
          ) : null}
        </div>
        <SyntheticImage src={r.example_image_url} label="Example — AI-generated" alt="Protocol example image used for the self-check" className="h-fit" />
      </div>
      {r.suggestions.length ? (
        <div>
          <div className="caps text-[10px] text-muted-foreground">Suggestions</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {r.suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <GrokbotProvenance>AI-generated · from the live frame and relevance checks · {new Date(job.finishedAt).toLocaleTimeString()}</GrokbotProvenance>
    </div>
  );
}
