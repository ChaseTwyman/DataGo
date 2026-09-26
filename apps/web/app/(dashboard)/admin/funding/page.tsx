"use client";
import { LoaderCircle, Play, Plus, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { formatCents, type Contribution, type FundingRequest, type Sponsor } from "@groundtruth/shared";
import { Switch } from "@/components/ds/controls";
import { useConfirm } from "@/components/ds/Dialog";
import { Notice, Readout, ReadoutGrid, Section } from "@/components/ds/primitives";
import { RelativeTime } from "@/components/ds/RelativeTime";
import { Empty, ErrorBox, Loading, PageHeader } from "@/components/page";
import { toast } from "@/components/Toaster";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { api, errorMessage } from "@/lib/client/api";
import { useMe } from "@/lib/client/me";
import { dollarsToCents } from "@/lib/client/pricePreview";
import { useApi } from "@/lib/client/useApi";

const num = "text-right tabular-nums";

/**
 * Admin → Funding: sponsors, (simulated) contributions, the pool by earmark, and every request's
 * allocation. Ledgers are append-only: mistakes are corrected with reversals.
 */
export default function AdminFundingPage() {
  const { me } = useMe();
  const overview = useApi(me?.is_admin ? () => api.adminFunding() : null, "admin:funding");
  const protocols = useApi(me?.is_admin ? () => api.protocols() : null, "protocols");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  if (me && !me.is_admin) return <ErrorBox className="m-6" message="Only administrators can manage funding." />;
  const o = overview.data;

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await api.adminRunAllocation();
      toast(`Allocation run: ${r.funded} funded, ${r.still_pending} still pending, ${formatCents(r.released_cents)} released.`, "success");
      await overview.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Funding"
        description="Sponsors fund a pool; the allocation engine funds data requests from it (earmarks first, then the general pool). All money is simulated."
        actions={
          <Button onClick={() => void run()} disabled={running}>
            {running ? <LoaderCircle className="animate-spin" aria-hidden /> : <Play aria-hidden />} Run allocation
          </Button>
        }
      />
      <ErrorBox message={error ?? overview.error} className="mx-6 my-3" onRetry={overview.error ? () => void overview.refresh() : undefined} />
      {!o ? (
        overview.loading ? <Loading /> : null
      ) : (
        <>
          <ReadoutGrid className="lg:grid-cols-4">
            <Readout label="Contributed" value={formatCents(o.totals.contributed_cents)} sub={`${o.sponsors.length} sponsors`} />
            <Readout label="Allocated" value={formatCents(o.totals.allocated_cents)} sub="to requests (incl. paid)" />
            <Readout label="Paid out" value={formatCents(o.totals.paid_cents)} sub="to contributors" />
            <Readout label="Available" value={<span className="text-primary">{formatCents(o.totals.available_cents)}</span>} sub="unallocated" />
          </ReadoutGrid>

          <div className="space-y-10 p-6">
            <Requests title={`Pending requests (${o.pending.length})`} rows={o.pending} pending onDone={overview.refresh} />
            <Buckets rows={o.buckets} />
            <div className="grid gap-10 xl:grid-cols-2">
              <Sponsors rows={o.sponsors} onDone={overview.refresh} />
              <ContributionForm sponsors={o.sponsors} slugs={[...new Set((protocols.data?.protocols ?? []).map((p) => p.slug))]} onDone={overview.refresh} />
            </div>
            <Requests title={`Funded requests (${o.funded.length})`} rows={o.funded} onDone={overview.refresh} />
            <Ledger rows={o.contributions} onDone={overview.refresh} />
          </div>
        </>
      )}
    </>
  );
}

function Buckets({ rows }: { rows: { contribution_id: string | null; sponsor_name: string | null; earmark: string; contributed_cents: number; allocated_cents: number; paid_cents: number; available_cents: number }[] }) {
  return (
    <Section title="Pool by earmark">
      <Table>
        <THead>
          <TR>
            <TH>Bucket</TH>
            <TH>Sponsor</TH>
            <TH className={num}>Contributed</TH>
            <TH className={num}>Allocated</TH>
            <TH className={num}>Paid</TH>
            <TH className={num}>Available</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((b) => (
            <TR key={b.contribution_id ?? "general"}>
              <TD>{b.earmark}</TD>
              <TD className="text-muted-foreground">{b.sponsor_name ?? "All unearmarked sponsors"}</TD>
              <TD className={num}>{formatCents(b.contributed_cents)}</TD>
              <TD className={num}>{formatCents(b.allocated_cents)}</TD>
              <TD className={num}>{formatCents(b.paid_cents)}</TD>
              <TD className={num}>{formatCents(b.available_cents)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <p className="text-xs text-muted-foreground">Paid per bucket is attributed in proportion to each request&apos;s allocations (rounded down).</p>
    </Section>
  );
}

function Requests({ title, rows, pending = false, onDone }: { title: string; rows: FundingRequest[]; pending?: boolean; onDone: () => void | Promise<void> }) {
  return (
    <Section title={title}>
      {rows.length === 0 ? (
        <Empty title={pending ? "No requests waiting" : "No funded requests"}>{pending ? "New requests the pool can't cover automatically appear here." : null}</Empty>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <RequestRow key={r.id} r={r} pending={pending} onDone={onDone} />
          ))}
        </div>
      )}
    </Section>
  );
}

function RequestRow({ r, pending, onDone }: { r: FundingRequest; pending: boolean; onDone: () => void | Promise<void> }) {
  const [amount, setAmount] = useState(((pending ? r.estimated_need_cents : r.allocation_cents) / 100).toFixed(2));
  const [reason, setReason] = useState(pending ? "Approved" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  const cents = dollarsToCents(amount);

  const apply = async () => {
    setError(null);
    if (!Number.isFinite(cents) || cents < 0) return setError("Enter an amount in dollars.");
    if (reason.trim().length < 3) return setError("Give a short reason (it goes in the ledger).");
    setBusy(true);
    try {
      const res = await api.adminSetAllocation(r.id, { allocation_cents: cents, reason: reason.trim() });
      toast(`${r.title}: ${formatCents(res.allocation_cents)} allocated (${res.status.replace(/_/g, " ")}).`, "success");
      await onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const pause = async () => {
    if (!(await confirm({ title: "Pause request", body: `Pause "${r.title}"? Contributors can't capture until it is resumed.`, confirmLabel: "Pause" }))) return;
    setBusy(true);
    try {
      await api.patchBounty(r.id, { status: r.status === "paused" ? "active" : "paused" });
      await onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id={`request-${r.id}`} className="border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/bounties/${r.id}`} className="font-medium underline-offset-2 hover:underline">
            {r.title}
          </Link>{" "}
          <Badge tone={r.status === "active" ? "success" : "warning"}>{r.status.replace(/_/g, " ")}</Badge>
          <p className="mt-1 text-xs text-muted-foreground">
            {r.protocol_name} · {r.cells_total} cells × {r.target_per_cell} · {r.requested_by ?? "unknown researcher"} · ends{" "}
            <RelativeTime iso={r.ends_at} />
          </p>
          {r.justification ? <p className="mt-1 max-w-3xl text-sm text-foreground/85">{r.justification}</p> : null}
          {r.funding_reason ? <p className="mt-1 text-xs text-warning">{r.funding_reason}</p> : null}
        </div>
        <div className="text-right text-xs text-muted-foreground tabular-nums">
          <div>
            allocated <span className="text-foreground">{formatCents(r.allocation_cents)}</span> · paid {formatCents(r.spent_cents)}
          </div>
          <div>
            est. need {formatCents(r.estimated_need_cents)} · min viable {formatCents(r.min_viable_cents)}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Field label={pending ? "Approve with ($)" : "Set allocation to ($)"} htmlFor={`amt-${r.id}`} className="w-40">
          <Input id={`amt-${r.id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reason" htmlFor={`why-${r.id}`} className="min-w-48 flex-1">
          <Input id={`why-${r.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Recorded in the pool ledger" />
        </Field>
        <Button size="sm" onClick={() => void apply()} disabled={busy}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null} {pending ? "Approve" : "Adjust"}
        </Button>
        {!pending ? (
          <Button size="sm" variant="outline" onClick={() => void pause()} disabled={busy}>
            {r.status === "paused" ? "Resume" : "Pause"}
          </Button>
        ) : null}
      </div>
      <ErrorBox message={error} className="mt-2" />
    </div>
  );
}

function Sponsors({ rows, onDone }: { rows: Sponsor[]; onDone: () => void | Promise<void> }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [logo, setLogo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.adminCreateSponsor({ name, url: url.trim() || null, logo_url: logo.trim() || null });
      setName("");
      setUrl("");
      setLogo("");
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (s: Sponsor) => {
    setError(null);
    try {
      await api.adminPatchSponsor(s.id, { active: !s.active });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Section title="Sponsors">
      {rows.length === 0 ? <Empty title="No sponsors yet" /> : null}
      <ul className="divide-y border">
        {rows.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium">{s.name}</div>
              <div className="truncate text-xs text-muted-foreground">{s.url ?? "no link"}</div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs tabular-nums text-muted-foreground">{formatCents(s.contributed_cents)}</span>
              <Switch checked={s.active} onChange={() => void toggle(s)} label={`${s.name} active`} />
            </div>
          </li>
        ))}
      </ul>
      <form onSubmit={(e) => void create(e)} className="grid gap-2 sm:grid-cols-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sponsor name" maxLength={120} required aria-label="Sponsor name" />
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https:// (optional)" type="url" aria-label="Sponsor link" />
        <Input value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="Logo URL (optional)" type="url" aria-label="Sponsor logo" />
        <Button type="submit" size="sm" variant="outline" disabled={busy || !name.trim()} className="sm:col-span-3">
          <Plus aria-hidden /> Add sponsor
        </Button>
      </form>
      <ErrorBox message={error} />
    </Section>
  );
}

function ContributionForm({ sponsors, slugs, onDone }: { sponsors: Sponsor[]; slugs: string[]; onDone: () => void | Promise<void> }) {
  const active = sponsors.filter((s) => s.active);
  const [sponsorId, setSponsorId] = useState("");
  const [amount, setAmount] = useState("500.00");
  const [slug, setSlug] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radiusKm, setRadiusKm] = useState("");
  const [bountyId, setBountyId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sid = sponsorId || active[0]?.id || "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const cents = dollarsToCents(amount);
    if (!Number.isFinite(cents) || cents <= 0) return setError("Enter an amount in dollars.");
    const region = lat.trim() || lng.trim() || radiusKm.trim();
    if (region && ![lat, lng, radiusKm].every((v) => Number.isFinite(Number(v)) && v.trim() !== "")) {
      return setError("A region needs latitude, longitude and radius.");
    }
    setBusy(true);
    try {
      await api.adminContribute({
        sponsor_id: sid,
        amount_cents: cents,
        protocol_slug: slug || null,
        region_center_lat: region ? Number(lat) : null,
        region_center_lng: region ? Number(lng) : null,
        region_radius_m: region ? Number(radiusKm) * 1000 : null,
        bounty_id: bountyId.trim() || null,
        note: note.trim() || null,
      });
      toast(`Recorded ${formatCents(cents)}; pending requests were re-checked.`, "success");
      setNote("");
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Record a contribution">
      {active.length === 0 ? (
        <Notice tone="info">Add an active sponsor first.</Notice>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="grid grid-cols-2 gap-3">
          <Field label="Sponsor" htmlFor="c-sponsor">
            <Select id="c-sponsor" value={sid} onChange={(e) => setSponsorId(e.target.value)}>
              {active.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount ($, simulated)" htmlFor="c-amount">
            <Input id="c-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
          <Field label="Earmark: protocol (optional)" htmlFor="c-slug">
            <Select id="c-slug" value={slug} onChange={(e) => setSlug(e.target.value)}>
              <option value="">Any protocol</option>
              {slugs.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Earmark: request id (optional)" htmlFor="c-bounty">
            <Input id="c-bounty" value={bountyId} onChange={(e) => setBountyId(e.target.value)} placeholder="uuid" />
          </Field>
          <div className="col-span-2 grid grid-cols-3 gap-2">
            <Field label="Region lat" htmlFor="c-lat">
              <Input id="c-lat" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="optional" />
            </Field>
            <Field label="Region lng" htmlFor="c-lng">
              <Input id="c-lng" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} />
            </Field>
            <Field label="Radius (km)" htmlFor="c-radius">
              <Input id="c-radius" inputMode="decimal" value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} />
            </Field>
          </div>
          <Field label="Note" htmlFor="c-note" className="col-span-2">
            <Textarea id="c-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. 2026 hurricane-season grant" />
          </Field>
          <Button type="submit" className="col-span-2" disabled={busy || !sid}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <Plus aria-hidden />} Record contribution
          </Button>
          <ErrorBox message={error} className="col-span-2" />
        </form>
      )}
    </Section>
  );
}

function Ledger({ rows, onDone }: { rows: Contribution[]; onDone: () => void | Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();
  const reversed = new Map<string, number>();
  for (const r of rows) if (r.reverses_id) reversed.set(r.reverses_id, (reversed.get(r.reverses_id) ?? 0) + r.amount_cents);

  const reverse = async (c: Contribution) => {
    const left = c.amount_cents - (reversed.get(c.id) ?? 0);
    const ok = await confirm({
      title: "Reverse contribution",
      body: `Record a reversal of ${formatCents(left)} from ${c.sponsor_name}? Only money not yet allocated to requests can be reversed. The original entry stays in the ledger.`,
      confirmLabel: "Reverse",
      tone: "danger",
    });
    if (!ok) return;
    setError(null);
    try {
      await api.adminReverseContribution(c.id, left, "Reversed by admin");
      await onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Section title="Contribution ledger (append-only)">
      <ErrorBox message={error} />
      {rows.length === 0 ? (
        <Empty title="No contributions yet" />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Sponsor</TH>
              <TH>Earmark</TH>
              <TH>Note</TH>
              <TH className={num}>Amount</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id}>
                <TD className="whitespace-nowrap text-muted-foreground">
                  <RelativeTime iso={c.created_at} />
                </TD>
                <TD>{c.sponsor_name}</TD>
                <TD className="text-muted-foreground">{c.earmark}</TD>
                <TD className="max-w-64 truncate text-muted-foreground">{c.note ?? ""}</TD>
                <TD className={num}>{c.kind === "reversal" ? `−${formatCents(c.amount_cents)}` : formatCents(c.amount_cents)}</TD>
                <TD className="text-right">
                  {c.kind === "contribution" && c.amount_cents - (reversed.get(c.id) ?? 0) > 0 ? (
                    <Button size="sm" variant="ghost" onClick={() => void reverse(c)}>
                      <RotateCcw aria-hidden /> Reverse
                    </Button>
                  ) : null}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Section>
  );
}
