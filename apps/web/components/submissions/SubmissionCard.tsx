"use client";
import { ChevronDown, ChevronRight, ImageOff, MapPin } from "lucide-react";
import { useState, type ReactNode } from "react";
import { formatCents, type LenientSubmissionWithMedia as SubmissionWithMedia } from "@groundtruth/shared";
import { extractedRows, formatScore } from "@/lib/client/checkFormat";
import { cn, formatTime, shortId } from "@/lib/client/cn";
import { api } from "@/lib/client/api";
import { RelativeTime } from "../ds/RelativeTime";
import { GrokbotAsk } from "../grokbot/GrokbotAsk";
import { ReviewBrief } from "../grokbot/ReviewBrief";
import { ReasonCode, SubmissionStatusBadge } from "../status";
import { CheckTable } from "./CheckTable";

export function SubmissionCard({
  s,
  fresh = false,
  defaultOpen = false,
  showBounty = false,
  actions,
  brief = true,
}: {
  s: SubmissionWithMedia;
  fresh?: boolean;
  defaultOpen?: boolean;
  showBounty?: boolean;
  actions?: ReactNode;
  /** Show the reviewer brief inside the card for needs_review items (the Review queue renders it beside its buttons instead). */
  brief?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const thumb = s.media_urls[0];
  return (
    <div className={cn("rounded-sm border bg-card transition-colors hover:border-input", fresh && "gt-arrive")}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-start gap-3 p-3 text-left hover:bg-white/[0.02]"
      >
        <div className="size-14 shrink-0 overflow-hidden rounded-sm border bg-muted">
          {thumb ? (
            <img src={thumb} alt="Submission frame 1" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-muted-foreground">
              <ImageOff className="size-4" aria-hidden />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <SubmissionStatusBadge status={s.status} />
            {s.verifier === "none" || s.verifier === "mock" ? (
              <span
                className="caps rounded-[2px] border border-warning/45 px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.1em] text-warning"
                title="Not verified by the real pipeline: never exported or published"
              >
                {s.verifier === "none" ? "Demo seed" : "Mock AI"}
              </span>
            ) : null}
            {s.payout_cents !== null && s.payout_cents > 0 ? (
              <span className="numeral text-lg text-primary">{formatCents(s.payout_cents)}</span>
            ) : null}
            <RelativeTime iso={s.received_at} className="ml-auto text-[11px] whitespace-nowrap text-muted-foreground" />
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {showBounty && s.bounty_title ? <span className="font-medium text-foreground">{s.bounty_title} · </span> : null}
            conf {formatScore(s.confidence)} · cell <span className="font-mono">{s.h3_cell.slice(-6)}</span>
            {headline(s.extracted)}
          </div>
          {s.reason_codes.length ? (
            <div className="flex flex-wrap gap-1">
              {s.reason_codes.slice(0, 4).map((r) => (
                <ReasonCode key={r} code={r} />
              ))}
              {s.reason_codes.length > 4 ? (
                <span className="text-[11px] text-muted-foreground">+{s.reason_codes.length - 4}</span>
              ) : null}
            </div>
          ) : null}
        </div>
        {open ? (
          <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </button>
      {open ? <SubmissionDetail s={s} brief={brief} /> : null}
      {actions ? <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">{actions}</div> : null}
    </div>
  );
}

function headline(extracted: Record<string, unknown> | null): string {
  if (!extracted) return "";
  const depth = extracted["depth_cm"];
  if (typeof depth === "number") return ` · depth ${Math.round(depth)} cm`;
  return "";
}

export function SubmissionDetail({ s, brief = true }: { s: SubmissionWithMedia; brief?: boolean }) {
  const fields = extractedRows(s.extracted);
  const notes = extractedRows(s.field_notes);
  const settled = s.status !== "pending" && s.status !== "verifying";
  return (
    <div className="space-y-4 border-t p-3">
      {settled ? (
        <GrokbotAsk
          label="Explain this result"
          title="Explanation"
          cacheKey={`explain:${s.id}:${s.status}`}
          load={(refresh) => api.grokbotExplain(s.id, refresh)}
        />
      ) : null}
      {brief && s.status === "needs_review" ? <ReviewBrief submissionId={s.id} /> : null}
      <section>
        <h4 className="caps mb-2 text-[10px] text-muted-foreground">Frames ({s.media_urls.length || s.media.length})</h4>
        {s.media_purged_at ? (
          <p className="text-xs text-muted-foreground">
            Photos deleted per retention policy ({new Date(s.media_purged_at).toLocaleDateString()}). The verification record below is kept.
          </p>
        ) : s.media_urls.some(Boolean) ? (
          <div className="grid grid-cols-3 gap-2">
            {s.media_urls.map((u, i) => (
              <a key={i} href={u} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-sm border hover:border-muted-foreground">
                <img src={u} alt={`Frame ${i + 1}`} className="aspect-[4/3] w-full object-cover" />
              </a>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No media URLs available.</p>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        <KV k="Confidence" v={formatScore(s.confidence)} />
        <KV k="Protocol score" v={formatScore(s.protocol_score)} />
        <KV k="Authenticity" v={formatScore(s.authenticity_score)} />
        <KV k="Payout" v={s.payout_cents !== null ? formatCents(s.payout_cents) : "—"} />
      </section>

      <section>
        <h4 className="caps mb-2 text-[10px] text-muted-foreground">Verification checks</h4>
        <CheckTable checks={s.checks} />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="caps mb-2 text-[10px] text-muted-foreground">Extracted fields</h4>
          <KVTable rows={fields} empty="Not extracted yet." />
        </div>
        <div>
          <h4 className="caps mb-2 text-[10px] text-muted-foreground">Field notes</h4>
          <KVTable rows={notes} empty="No field notes." />
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <MapPin className="size-3" aria-hidden />
          {s.lat.toFixed(5)}, {s.lng.toFixed(5)}
          {s.accuracy_m !== null ? ` ±${Math.round(s.accuracy_m)} m` : ""}
        </span>
        <span>captured {formatTime(s.captured_at)}</span>
        <span>received {formatTime(s.received_at)}</span>
        <span className="font-mono">id {shortId(s.id)}</span>
        <span className="font-mono">user {shortId(s.user_id)}</span>
      </section>
    </div>
  );
}

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="rounded-sm border px-3 py-2">
      <div className="caps text-[10px] text-muted-foreground">{k}</div>
      <div className="numeral mt-1 text-xl">{v}</div>
    </div>
  );
}

function KVTable({ rows, empty }: { rows: { key: string; value: string }[]; empty: string }) {
  if (!rows.length) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <table className="w-full text-xs">
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b last:border-0">
            <td className="py-1 pr-2 font-mono text-muted-foreground">{r.key}</td>
            <td className="py-1 text-right break-all tabular-nums">{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

