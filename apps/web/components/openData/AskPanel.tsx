"use client";
import { BookOpen, Download, MessageSquareText, Search, Sparkles } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { cn } from "@/lib/client/cn";
import {
  askData,
  cellText,
  chartSeries,
  downloadText,
  mapCells,
  PUBLIC_EXAMPLES,
  RESEARCHER_EXAMPLES,
  resultCsv,
  type AskAnswer,
  type AskResult,
  type Series,
} from "@/lib/client/copilot";
import { grokbotError, isTemplate, type GrokbotErrorView } from "@/lib/client/grokbot";
import { GrokbotErrorNotice, GrokbotMessageBody, GrokbotProvenance, GrokbotSkeleton } from "../grokbot/GrokbotCard";
import { CodeBlock } from "../ds/JsonViewer";
import { EmptyState, Notice, Panel, PanelHeader } from "../ds/primitives";
import { COLORS } from "../ds/tokens";
import { Button } from "../ui/button";
import { Textarea } from "../ui/form";
import { Table, TBody, TD, TH, THead, TR } from "../ui/table";
import { HexCoverage } from "./HexCoverage";

/**
 * "Ask the data": question box + example chips → answer card, result table, chart or cell map,
 * "How I answered" (the exact plan) and "Cite" (methods note + CSV). Used on the public /data page
 * (mode "public", no login) and the researcher dashboard /ask (mode "researcher", optional bounty).
 */
export function AskPanel({
  mode,
  dataset,
  bountyId,
  className,
}: {
  mode: "researcher" | "public";
  dataset?: string;
  bountyId?: string;
  className?: string;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [error, setError] = useState<GrokbotErrorView | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const examples = mode === "researcher" ? RESEARCHER_EXAMPLES : PUBLIC_EXAMPLES;

  const run = async (q: string) => {
    const text = q.trim();
    if (text.length < 3 || loading) return;
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const a = await askData({ question: text, ...(dataset ? { dataset } : {}), ...(bountyId ? { bounty_id: bountyId } : {}) }, mode);
      if (mine === seq.current) setAnswer(a);
    } catch (e) {
      if (mine === seq.current) setError(grokbotError(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(question);
  };

  return (
    <div className={cn("space-y-4", className)}>
      <Panel>
        <PanelHeader title="Ask the data" icon={MessageSquareText} />
        <form onSubmit={submit} className="space-y-3 p-4">
          <label htmlFor="ask-question" className="sr-only">
            Question about the published observations
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <Textarea
              id="ask-question"
              value={question}
              maxLength={500}
              rows={2}
              placeholder="e.g. Median depth by surface type?"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void run(question);
                }
              }}
              className="min-w-0 flex-1"
            />
            <Button type="submit" disabled={loading || question.trim().length < 3} className="sm:h-16">
              <Search aria-hidden /> {loading ? "Asking…" : "Ask"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Example questions">
            {examples.map((x) => (
              <button
                key={x}
                type="button"
                disabled={loading}
                onClick={() => {
                  setQuestion(x);
                  void run(x);
                }}
                className="cursor-pointer rounded-sm border px-2.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                {x}
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Answers come only from the published, privacy-coarsened observations. Grok turns your question into a query plan (shown
            below); the numbers are computed by the server, never by the model.
          </p>
        </form>
      </Panel>

      {error ? <GrokbotErrorNotice error={error} onRetry={() => void run(question)} /> : null}
      {loading && !answer ? (
        <Panel className="p-4">
          <GrokbotSkeleton label="Planning the query and computing the result…" />
        </Panel>
      ) : null}
      {answer ? (
        <div className={cn("space-y-4", loading && "opacity-50 transition-opacity")} aria-busy={loading}>
          <AnswerView a={answer} />
        </div>
      ) : null}
    </div>
  );
}

function AnswerView({ a }: { a: AskAnswer }) {
  if (a.status !== "answered") {
    return (
      <Notice tone="info" title="Can't answer that one">
        {a.refusal ?? "I can only answer questions about the published observations in this dataset."} Try one of the examples above.
      </Notice>
    );
  }
  const r = a.result;
  return (
    <>
      <Panel>
        <PanelHeader title="Answer" icon={Sparkles} />
        <div className="space-y-3 p-4">
          {a.answer ? <GrokbotMessageBody message={a.answer} /> : null}
          {a.answer ? <GrokbotProvenance template={isTemplate(a.answer)}>AI-written · grounded in the computed result</GrokbotProvenance> : null}
        </div>
      </Panel>
      {r && r.rows.length === 0 ? (
        <EmptyState title="No matching observations">
          Nothing published matched these filters ({r.observations_in_scope} observations in scope). Try a wider time window or distance.
        </EmptyState>
      ) : null}
      {r && r.rows.length > 0 ? (
        <>
          <ResultChart result={r} chart={a.chart} />
          <ResultTable result={r} />
        </>
      ) : null}
      <HowAndCite a={a} />
    </>
  );
}

function ResultTable({ result }: { result: AskResult }) {
  return (
    <Panel>
      <PanelHeader
        title={
          <span>
            Result <span className="tabular-nums text-muted-foreground">· {result.total_rows} row{result.total_rows === 1 ? "" : "s"}</span>
          </span>
        }
      />
      <Table containerClassName="max-h-[420px]">
        <THead>
          <TR>
            {result.columns.map((c) => (
              <TH key={c.name} className={cn(c.type === "number" && "text-right")} title={c.name}>
                {c.label || c.name}
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {result.rows.map((row, i) => (
            <TR key={i}>
              {result.columns.map((c) => (
                <TD key={c.name} className={cn("text-xs whitespace-nowrap", c.type === "number" && "text-right tabular-nums", c.name === "h3_cell" || c.name === "observation_id" ? "font-mono" : "")}>
                  {cellText(row[c.name], c.type)}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
      {result.truncated ? (
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
          Showing the first {result.rows.length} of {result.total_rows} rows. Download the CSV below or narrow the question.
        </p>
      ) : null}
    </Panel>
  );
}

function ResultChart({ result, chart }: { result: AskResult; chart: string }) {
  if (chart === "map") {
    const cells = mapCells(result);
    if (cells.length === 0) return null;
    return (
      <Panel>
        <PanelHeader title="Map · H3 cells" />
        <div className="mx-auto aspect-square w-full max-w-md bg-black p-2">
          <HexCoverage cells={cells} accent={COLORS.accent} className="h-full w-full" />
        </div>
        <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">Shading = observations per cell (faint = none). Hover a cell for its count.</p>
      </Panel>
    );
  }
  const s = chartSeries(result, chart);
  if (!s) return null;
  return (
    <Panel>
      <PanelHeader title={`${s.valueLabel} by ${s.keyLabel}`} />
      <div className="p-4">{chart === "line" ? <LineChart s={s} /> : <BarChart s={s} />}</div>
    </Panel>
  );
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));

/** Horizontal bars: labels left, value at the bar end; one series in the accent colour. */
function BarChart({ s }: { s: Series }) {
  const n = Math.min(s.values.length, 30);
  const max = Math.max(...s.values.slice(0, n).map((v) => Math.abs(v)), 1e-9);
  const rowH = 26;
  const labelW = 150;
  const W = 640;
  const plotW = W - labelW - 60;
  return (
    <svg viewBox={`0 0 ${W} ${n * rowH + 8}`} className="w-full" role="img" aria-label={`${s.valueLabel} by ${s.keyLabel}, bar chart`}>
      <line x1={labelW} x2={labelW} y1={0} y2={n * rowH} stroke="currentColor" strokeOpacity={0.2} />
      {s.values.slice(0, n).map((v, i) => {
        const w = Math.max(2, (Math.abs(v) / max) * plotW);
        const y = i * rowH + 5;
        return (
          <g key={i}>
            <title>{`${s.labels[i]}: ${fmt(v)} ${s.valueLabel}`}</title>
            <rect x={0} y={i * rowH} width={W} height={rowH} fill="transparent" />
            <text x={labelW - 8} y={y + 12} textAnchor="end" className="fill-muted-foreground text-[11px]">
              {truncate(s.labels[i] ?? "", 22)}
            </text>
            <rect x={labelW + 1} y={y} width={w} height={rowH - 10} rx={4} fill={COLORS.accent} />
            <text x={labelW + w + 6} y={y + 12} className="fill-foreground text-[11px] tabular-nums">
              {fmt(v)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** 2px line with ≥ 8px point markers; first/last labels on the time axis. */
function LineChart({ s }: { s: Series }) {
  const W = 640;
  const H = 220;
  const pad = { l: 44, r: 12, t: 12, b: 28 };
  const max = Math.max(...s.values, 0);
  const min = Math.min(...s.values, 0);
  const span = max - min || 1;
  const x = (i: number) => pad.l + (s.values.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (s.values.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
  const d = s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${s.valueLabel} over ${s.keyLabel}, line chart`}>
      <line x1={pad.l} x2={W - pad.r} y1={y(min)} y2={y(min)} stroke="currentColor" strokeOpacity={0.2} />
      <text x={pad.l - 6} y={y(max) + 4} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
        {fmt(max)}
      </text>
      <text x={pad.l - 6} y={y(min) + 4} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
        {fmt(min)}
      </text>
      <path d={d} fill="none" stroke={COLORS.accent} strokeWidth={2} strokeLinejoin="round" />
      {s.values.map((v, i) => (
        <g key={i}>
          <title>{`${s.labels[i]}: ${fmt(v)} ${s.valueLabel}`}</title>
          <circle cx={x(i)} cy={y(v)} r={10} fill="transparent" />
          <circle cx={x(i)} cy={y(v)} r={4} fill={COLORS.accent} stroke="var(--card)" strokeWidth={2} />
        </g>
      ))}
      <text x={pad.l} y={H - 8} className="fill-muted-foreground text-[10px]">
        {s.labels[0]}
      </text>
      {s.labels.length > 1 ? (
        <text x={W - pad.r} y={H - 8} textAnchor="end" className="fill-muted-foreground text-[10px]">
          {s.labels[s.labels.length - 1]}
        </text>
      ) : null}
    </svg>
  );
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function HowAndCite({ a }: { a: AskAnswer }) {
  const [copied, setCopied] = useState(false);
  const r = a.result;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel>
        <PanelHeader title="How I answered" icon={Search} />
        <div className="space-y-3 p-4 text-sm">
          <ol className="list-decimal space-y-1 pl-5 text-foreground/85">
            {a.plan_steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <details className="group">
            <summary className="caps cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">Exact query plan (JSON)</summary>
            <CodeBlock code={JSON.stringify(a.plan, null, 2)} className="mt-2" maxHeight={280} />
          </details>
          <p className="text-[11px] text-muted-foreground">
            Planner: {a.planner === "cache" ? "cached plan" : a.planner === "mock" ? "offline fixtures" : "Grok"} · the server validated the plan and ran it
            as a parameterized query.
          </p>
        </div>
      </Panel>
      <Panel>
        <PanelHeader
          title="Cite"
          icon={BookOpen}
          actions={
            r ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => downloadText(resultCsv(r), `groundtruth-${a.dataset?.slug ?? "data"}-answer.csv`)}
              >
                <Download aria-hidden /> CSV
              </Button>
            ) : null
          }
        />
        <div className="space-y-3 p-4 text-sm">
          <p className="leading-relaxed text-foreground/85">{a.methods}</p>
          {a.methods ? (
            <button
              type="button"
              className="caps cursor-pointer text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(a.methods ?? "")
                  .then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  })
                  .catch(() => undefined);
              }}
            >
              {copied ? "Copied" : "Copy methods note"}
            </button>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
