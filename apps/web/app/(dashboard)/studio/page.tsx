"use client";
import { ArrowRight, Braces, CheckCircle2, FileText, LoaderCircle, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ProtocolSchema, type FieldQuestion, type Protocol } from "@groundtruth/shared";
import { Empty, ErrorBox, Loading, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";
import {
  clearDraftJob,
  draftStage,
  extractionFields,
  FIELD_TYPES,
  getDraftJob,
  parseProtocolJson,
  protocolIssues,
  startDraftJob,
  subscribeDraftJob,
  withExtractionFields,
  type ExtractionField,
} from "@/lib/client/studio";
import { useApi } from "@/lib/client/useApi";

const EXAMPLES = [
  "How high does water get under the Peachtree Creek underpasses after heavy rain?",
  "Map potholes and cracked sidewalks along bus routes, with a size estimate.",
  "Track which storm drains are blocked by leaves or trash before a storm.",
];

export default function StudioPage() {
  const protocols = useApi(() => api.protocols(), "protocols");
  const job = useSyncExternalStore(subscribeDraftJob, getDraftJob, getDraftJob);
  const [editing, setEditing] = useState<{ id: string; protocol: Protocol } | null>(null);
  const [published, setPublished] = useState<{ id: string; name: string } | null>(null);

  // A finished draft opens in the editor (once), and the drafts list picks it up.
  useEffect(() => {
    if (job.status === "done") {
      setEditing({ id: job.protocolId, protocol: job.protocol });
      setPublished(null);
      clearDraftJob();
      void protocols.refresh();
    }
  }, [job, protocols]);

  const drafts = (protocols.data?.protocols ?? []).filter((p) => p.status === "draft");

  return (
    <>
      <PageHeader
        title="Protocol Studio"
        description="Describe the data you need in plain language. Grok drafts a capture protocol; you review, edit and publish it."
      />
      <div className="grid gap-4 p-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          {published ? (
            <Card className="border-emerald-300">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
                <p className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
                  <span>
                    <span className="font-medium">{published.name}</span> is published. Every researcher can now use it for bounties.
                  </span>
                </p>
                <Link href={`/bounties/new?protocol=${published.id}`} className={buttonVariants()}>
                  Create bounty with this protocol <ArrowRight aria-hidden />
                </Link>
              </CardContent>
            </Card>
          ) : null}
          {editing ? (
            <DraftEditor
              key={editing.id}
              id={editing.id}
              initial={editing.protocol}
              onClose={() => setEditing(null)}
              onPublished={(name) => {
                setPublished({ id: editing.id, name });
                setEditing(null);
                void protocols.refresh();
              }}
            />
          ) : (
            <NeedForm />
          )}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-sm">Your drafts</CardTitle>
            <CardDescription>Only you can see and edit your drafts until you publish them.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <ErrorBox message={protocols.error} onRetry={() => void protocols.refresh()} />
            {protocols.loading && !protocols.data ? <Loading className="p-0" /> : null}
            {protocols.data && drafts.length === 0 ? <p className="text-sm text-muted-foreground">No drafts yet.</p> : null}
            {drafts.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  setPublished(null);
                  setEditing({ id: d.id, protocol: d.definition });
                }}
                className={cn(
                  "flex w-full cursor-pointer items-start gap-2 rounded-md border p-2 text-left text-sm hover:bg-muted/50",
                  editing?.id === d.id && "border-sky-400 bg-sky-50",
                )}
              >
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{d.name}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {d.slug} v{d.version}
                  </span>
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function NeedForm() {
  const job = useSyncExternalStore(subscribeDraftJob, getDraftJob, getDraftJob);
  const [need, setNeed] = useState(job.status === "running" || job.status === "error" ? job.need : "");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (job.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job.status]);

  const running = job.status === "running";
  const elapsed = running ? now - job.startedAt : 0;
  const tooShort = need.trim().length < 10;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-sky-600" aria-hidden /> What data do you need?
        </CardTitle>
        <CardDescription>
          Say what you want measured, where, and why. The draft includes safety rules, what must be in frame, anti-fake challenges, field
          questions, the fields to extract and acceptance thresholds.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          aria-label="Data need"
          rows={5}
          maxLength={2000}
          value={need}
          disabled={running}
          onChange={(e) => setNeed(e.target.value)}
          placeholder="e.g. How deep does water get on the streets around campus during flash floods?"
        />
        {!running && !need ? (
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => setNeed(ex)} className="cursor-pointer rounded-full border px-2.5 py-1 text-xs hover:bg-muted">
                {ex}
              </button>
            ))}
          </div>
        ) : null}
        {running ? (
          <div role="status" className="space-y-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
            <div className="flex items-center gap-2 font-medium">
              <LoaderCircle className="size-4 animate-spin" aria-hidden /> {draftStage(elapsed)}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-sky-100">
              <div className="h-full rounded-full bg-sky-500 transition-[width] duration-1000" style={{ width: `${Math.min(95, (elapsed / 120_000) * 100)}%` }} />
            </div>
            <p className="text-xs text-sky-900/80">
              {Math.round(elapsed / 1000)} s · usually 1–2 minutes. You can leave this page; the draft is saved to &quot;Your drafts&quot; when it&apos;s
              ready.
            </p>
          </div>
        ) : null}
        <ErrorBox message={job.status === "error" ? job.message : null} />
        <Button disabled={running || tooShort} onClick={() => startDraftJob(need.trim(), (n) => api.draftProtocol(n), errorMessage)}>
          {running ? <LoaderCircle className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
          {running ? "Drafting…" : "Draft protocol"}
        </Button>
        {tooShort && need.length > 0 ? <p className="text-xs text-muted-foreground">Describe the need in at least 10 characters.</p> : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- editor

function DraftEditor({ id, initial, onClose, onPublished }: { id: string; initial: Protocol; onClose: () => void; onPublished: (name: string) => void }) {
  const [p, setP] = useState<Protocol>(initial);
  const [tab, setTab] = useState<"form" | "json">("form");
  const [json, setJson] = useState(() => JSON.stringify(initial, null, 2));
  const [jsonLines, setJsonLines] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  // Rows live in their own state so a new (still unnamed) field doesn't vanish from the form.
  const [fields, setFieldRows] = useState<ExtractionField[]>(() => extractionFields(initial));
  const setFields = (f: ExtractionField[]) => {
    setFieldRows(f);
    setP((d) => withExtractionFields(d, f));
  };
  const load = (next: Protocol) => {
    setP(next);
    setFieldRows(extractionFields(next));
  };

  const set = (fn: (d: Protocol) => Protocol) => setP((d) => fn(d));
  const cap = (patch: Partial<Protocol["capture"]>) => set((d) => ({ ...d, capture: { ...d.capture, ...patch } }));
  const acc = (patch: Partial<Protocol["acceptance"]>) => set((d) => ({ ...d, acceptance: { ...d.acceptance, ...patch } }));

  const switchTab = (t: "form" | "json") => {
    if (t === tab) return;
    if (t === "json") {
      setJson(JSON.stringify(p, null, 2));
      setJsonLines(null);
      setTab("json");
      return;
    }
    // Leaving the JSON editor applies it only if it's valid.
    const r = parseProtocolJson(json);
    if (!r.ok) return setJsonLines(r.lines);
    load(r.protocol);
    setJsonLines(null);
    setTab("form");
  };

  const publish = async () => {
    setError(null);
    setIssues([]);
    let def = p;
    if (tab === "json") {
      const r = parseProtocolJson(json);
      if (!r.ok) return setJsonLines(r.lines);
      def = r.protocol;
    }
    const v = ProtocolSchema.safeParse(def);
    if (!v.success) return setIssues(protocolIssues(v.error));
    if (!window.confirm(`Publish "${v.data.name}"? Published protocols can't be edited; you'd draft a new version.`)) return;
    setBusy(true);
    try {
      await api.publishProtocol(id, v.data);
      onPublished(v.data.name);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };


  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Review draft <Badge tone="muted">draft</Badge>
            <Badge tone="muted" className="font-mono">
              {p.slug} v{p.version}
            </Badge>
          </CardTitle>
          <CardDescription className="mt-1">Check every section. Contributors see this wording, and the verifier enforces it.</CardDescription>
        </div>
        <div className="flex rounded-md border p-0.5 text-xs" role="tablist" aria-label="Editor">
          {(["form", "json"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => switchTab(t)}
              className={cn("flex cursor-pointer items-center gap-1 rounded px-2.5 py-1", tab === t ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              {t === "form" ? <FileText className="size-3.5" aria-hidden /> : <Braces className="size-3.5" aria-hidden />}
              {t === "form" ? "Form" : "Raw JSON"}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {tab === "json" ? (
          <div className="space-y-2">
            <Textarea
              aria-label="Protocol JSON"
              className="min-h-[28rem] font-mono text-xs"
              spellCheck={false}
              value={json}
              onChange={(e) => {
                setJson(e.target.value);
                setJsonLines(null);
              }}
            />
            <IssueList lines={jsonLines} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const r = parseProtocolJson(json);
                setJsonLines(r.ok ? null : r.lines);
                if (r.ok) load(r.protocol);
              }}
            >
              Validate JSON
            </Button>
          </div>
        ) : (
          <>
            <Section title="Basics">
              <Field label="Name" htmlFor="p-name">
                <Input id="p-name" value={p.name} onChange={(e) => set((d) => ({ ...d, name: e.target.value }))} />
              </Field>
              <Field label="Why it matters" htmlFor="p-why" hint="Shown to contributors in the briefing.">
                <Textarea id="p-why" rows={3} value={p.why_it_matters} onChange={(e) => set((d) => ({ ...d, why_it_matters: e.target.value }))} />
              </Field>
            </Section>

            <Section title="Safety">
              <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                <Field label="Level" htmlFor="p-level">
                  <Select
                    id="p-level"
                    value={p.safety.level}
                    onChange={(e) => set((d) => ({ ...d, safety: { ...d.safety, level: e.target.value as Protocol["safety"]["level"] } }))}
                  >
                    {["low", "normal", "elevated", "high"].map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Check-in question (yes means safe)" htmlFor="p-checkin">
                  <Input
                    id="p-checkin"
                    value={p.safety.check_in_question}
                    onChange={(e) => set((d) => ({ ...d, safety: { ...d.safety, check_in_question: e.target.value } }))}
                  />
                </Field>
              </div>
              <StringList label="Safety rules" items={p.safety.rules} onChange={(rules) => set((d) => ({ ...d, safety: { ...d.safety, rules } }))} />
            </Section>

            <Section title="Required in frame">
              <RowList
                items={p.capture.required_elements}
                blank={{ id: "", label: "", description: "" }}
                onChange={(required_elements) => cap({ required_elements })}
                render={(el, upd) => (
                  <div className="grid gap-2 sm:grid-cols-[140px_160px_1fr]">
                    <Input aria-label="Element id" placeholder="id (snake_case)" className="font-mono text-xs" value={el.id} onChange={(e) => upd({ ...el, id: e.target.value })} />
                    <Input aria-label="Element label" placeholder="Label" value={el.label} onChange={(e) => upd({ ...el, label: e.target.value })} />
                    <Input aria-label="Element description" placeholder="What the verifier checks" value={el.description} onChange={(e) => upd({ ...el, description: e.target.value })} />
                  </div>
                )}
              />
            </Section>

            <Section title="Anti-fake challenges" hint="One is picked at random for each capture; the burst must show the movement.">
              <RowList
                items={p.capture.challenges}
                blank={{ id: "", instruction: "", expect: "" }}
                onChange={(challenges) => cap({ challenges })}
                render={(c, upd) => (
                  <div className="grid gap-2 sm:grid-cols-[120px_1fr_1fr]">
                    <Input aria-label="Challenge id" placeholder="id" className="font-mono text-xs" value={c.id} onChange={(e) => upd({ ...c, id: e.target.value })} />
                    <Input aria-label="Instruction" placeholder="Spoken instruction" value={c.instruction} onChange={(e) => upd({ ...c, instruction: e.target.value })} />
                    <Input aria-label="Expected evidence" placeholder="Visible evidence across the burst" value={c.expect} onChange={(e) => upd({ ...c, expect: e.target.value })} />
                  </div>
                )}
              />
            </Section>

            <Section title="Field questions" hint="Asked by voice after the capture.">
              <RowList<FieldQuestion>
                items={p.capture.field_questions}
                blank={{ id: "", question: "", type: "text" }}
                allowEmpty
                onChange={(field_questions) => cap({ field_questions })}
                render={(q, upd) => (
                  <div className="grid gap-2 sm:grid-cols-[120px_1fr_110px]">
                    <Input aria-label="Question id" placeholder="id" className="font-mono text-xs" value={q.id} onChange={(e) => upd({ ...q, id: e.target.value })} />
                    <Input aria-label="Question" placeholder="Question" value={q.question} onChange={(e) => upd({ ...q, question: e.target.value })} />
                    <Select
                      aria-label="Answer type"
                      value={q.type}
                      onChange={(e) => {
                        const t = e.target.value as FieldQuestion["type"];
                        upd(t === "enum" ? { id: q.id, question: q.question, type: "enum", options: q.type === "enum" ? q.options : ["yes", "no"] } : { id: q.id, question: q.question, type: t });
                      }}
                    >
                      {["enum", "boolean", "number", "text"].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </Select>
                    {q.type === "enum" ? (
                      <Input
                        aria-label="Options"
                        className="sm:col-span-3"
                        placeholder="Options, comma-separated"
                        value={q.options.join(", ")}
                        onChange={(e) => upd({ ...q, options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                      />
                    ) : null}
                  </div>
                )}
              />
            </Section>

            <Section title="Extraction fields" hint="Structured values the verifier estimates from the photos. Extra JSON Schema keys (enum, min/max) are kept; edit them in Raw JSON.">
              <RowList<ExtractionField>
                items={fields}
                blank={{ name: "", type: "number|null", description: "", required: false }}
                onChange={setFields}
                render={(f, upd) => (
                  <div className="grid items-center gap-2 sm:grid-cols-[160px_130px_1fr_auto]">
                    <Input aria-label="Field name" placeholder="field_name" className="font-mono text-xs" value={f.name} onChange={(e) => upd({ ...f, name: e.target.value })} />
                    <Select aria-label="Field type" value={f.type} disabled={f.type === "other"} onChange={(e) => upd({ ...f, type: e.target.value as ExtractionField["type"] })}>
                      {f.type === "other" ? <option value="other">custom (JSON)</option> : null}
                      {FIELD_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </Select>
                    <Input aria-label="Field description" placeholder="Description" value={f.description} onChange={(e) => upd({ ...f, description: e.target.value })} />
                    <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                      <input type="checkbox" checked={f.required} onChange={(e) => upd({ ...f, required: e.target.checked })} /> required
                    </label>
                  </div>
                )}
              />
            </Section>

            <Section title="Acceptance thresholds">
              <div className="grid gap-3 sm:grid-cols-4">
                <NumberField label="Min protocol score" min={0} max={1} step={0.05} value={p.acceptance.min_protocol_score} onChange={(v) => acc({ min_protocol_score: v })} />
                <NumberField label="Min authenticity score" min={0} max={1} step={0.05} value={p.acceptance.min_authenticity_score} onChange={(v) => acc({ min_authenticity_score: v })} />
                <NumberField label="Corroboration radius (m)" min={1} step={10} value={p.acceptance.corroboration_radius_m} onChange={(v) => acc({ corroboration_radius_m: v })} />
                <NumberField label="Corroboration window (min)" min={1} step={5} value={p.acceptance.corroboration_window_min} onChange={(v) => acc({ corroboration_window_min: v })} />
              </div>
            </Section>
          </>
        )}

        <IssueList lines={issues.length ? issues : null} />
        <ErrorBox message={error} />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Back to new draft
          </Button>
          <Button onClick={() => void publish()} disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
            Publish protocol
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Edits are kept while this page is open and saved when you publish. Unpublished edits are lost if you leave; the original draft stays in
          Your drafts.
        </p>
      </CardContent>
    </Card>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function IssueList({ lines }: { lines: string[] | null }) {
  if (!lines?.length) return null;
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <p className="font-medium">Fix these before publishing:</p>
      <ul className="mt-1 list-disc pl-5">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

function NumberField({ label, value, onChange, min, max, step }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  const id = `n-${label.replace(/\W+/g, "-")}`;
  return (
    <Field label={label} htmlFor={id}>
      <Input id={id} type="number" value={Number.isFinite(value) ? value : ""} min={min} max={max} step={step} onChange={(e) => onChange(e.target.valueAsNumber)} />
    </Field>
  );
}

function StringList({ label, items, onChange }: { label: string; items: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <RowList items={items} blank="" onChange={onChange} render={(s, upd) => <Input aria-label={label} value={s} onChange={(e) => upd(e.target.value)} />} />
    </div>
  );
}

function RowList<T>({
  items,
  blank,
  onChange,
  render,
  allowEmpty = false,
}: {
  items: T[];
  blank: T;
  onChange: (v: T[]) => void;
  render: (item: T, update: (v: T) => void) => ReactNode;
  allowEmpty?: boolean;
}) {
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">{render(it, (v) => onChange(items.map((x, j) => (j === i ? v : x))))}</div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remove"
            disabled={!allowEmpty && items.length <= 1}
            onClick={() => onChange(items.filter((_, j) => j !== i))}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}
      {items.length === 0 ? <Empty className="p-3" title="None" /> : null}
      <Button variant="outline" size="sm" onClick={() => onChange([...items, blank])}>
        <Plus aria-hidden /> Add
      </Button>
    </div>
  );
}
