"use client";
import { Copy, LoaderCircle, MapPinOff, ShieldAlert, ShieldCheck, Sparkles, type LucideIcon } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import type { AttackType } from "@groundtruth/shared";
import { BountySelect, useSelectedBounty } from "@/components/BountyPicker";
import { Empty, ErrorBox, Loading, PageHeader, Stat } from "@/components/page";
import { ReasonCode, ToneBadge } from "@/components/status";
import { CheckTable } from "@/components/submissions/CheckTable";
import { SyntheticImage } from "@/components/SyntheticImage";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/client/api";
import { caughtBy, parseChecksLoose } from "@/lib/client/checkFormat";
import { cn, formatTime } from "@/lib/client/cn";
import { useApi } from "@/lib/client/useApi";

const ATTACKS: { type: AttackType; label: string; icon: LucideIcon; blurb: string }[] = [
  {
    type: "ai_generated",
    label: "AI-generated photo",
    icon: Sparkles,
    blurb: "Grok Imagine renders a realistic fake built from this bounty and protocol.",
  },
  {
    type: "recycled",
    label: "Recycled photo",
    icon: Copy,
    blurb: "Resubmit a previously accepted image as if it were new.",
  },
  {
    type: "wrong_place_time",
    label: "Wrong place / time",
    icon: MapPinOff,
    blurb: "A valid image with spoofed coordinates and timestamp outside the bounty.",
  },
];

const ATTACK_LABEL: Record<AttackType, string> = {
  ai_generated: "AI-generated",
  recycled: "Recycled",
  wrong_place_time: "Wrong place/time",
};

export default function RedTeamPage() {
  return (
    <Suspense fallback={<Loading />}>
      <RedTeam />
    </Suspense>
  );
}

function RedTeam() {
  const pick = useSelectedBounty();
  const bountyId = pick.selected?.id;
  const runs = useApi(bountyId ? () => api.redteamRuns(bountyId) : null, `redteam:${bountyId ?? ""}`, 5000);
  const [busy, setBusy] = useState<AttackType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRunId, setLastRunId] = useState<string | null>(null);

  const list = useMemo(
    () => [...(runs.data?.runs ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [runs.data],
  );
  const caught = list.filter((r) => r.caught).length;

  const launch = async (type: AttackType) => {
    if (!bountyId) return;
    setBusy(type);
    setError(null);
    try {
      const r = await api.redteamRun(bountyId, type);
      setLastRunId(r.run_id);
      await runs.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Red team"
        description="Attack our own verification with fakes. Runs go through the same pipeline (minus the live-session check) and are stored apart from submissions."
        actions={<BountySelect bounties={pick.bounties} value={bountyId} onChange={pick.select} />}
      />
      <div className="space-y-6 p-6">
        <ErrorBox message={pick.error ?? error ?? runs.error} />
        <div className="grid gap-3 md:grid-cols-3">
          {ATTACKS.map((a) => (
            <Card key={a.type} className="flex flex-col">
              <CardContent className="flex flex-1 flex-col gap-3 pt-5">
                <div className="flex items-center gap-2 font-semibold">
                  <a.icon className="size-4 text-red-600" aria-hidden /> {a.label}
                </div>
                <p className="flex-1 text-sm text-muted-foreground">{a.blurb}</p>
                <Button variant="destructive" disabled={!bountyId || busy !== null} onClick={() => void launch(a.type)}>
                  {busy === a.type ? <LoaderCircle className="animate-spin" aria-hidden /> : <ShieldAlert aria-hidden />}
                  {busy === a.type ? "Running attack…" : "Run attack"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardContent className="grid grid-cols-3 gap-4 pt-5">
            <Stat label="Runs" value={list.length} />
            <Stat label="Caught" value={caught} />
            <Stat
              label="Caught rate"
              value={
                <span className={cn(list.length && caught === list.length ? "text-emerald-700" : list.length ? "text-amber-700" : "")}>
                  {list.length ? `${Math.round((caught / list.length) * 100)}%` : "—"}
                </span>
              }
            />
          </CardContent>
        </Card>

        {runs.loading && !runs.data ? <Loading /> : null}
        {!runs.loading && list.length === 0 ? <Empty title="No runs yet">Pick an attack above.</Empty> : null}
        <div className="space-y-3">
          {list.map((r) => {
            const checks = parseChecksLoose(r.checks);
            const layers = caughtBy(checks);
            return (
              <Card key={r.id} className={cn(r.id === lastRunId && "ring-2 ring-red-300")}>
                <div className="grid gap-4 p-4 md:grid-cols-[240px_1fr]">
                  <SyntheticImage
                    src={r.image_url}
                    label={r.attack_type === "ai_generated" ? "AI-generated" : "Red team"}
                    tone="redteam"
                    alt={`Red-team ${ATTACK_LABEL[r.attack_type]} attack image`}
                    className="aspect-[4/3]"
                  />
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{ATTACK_LABEL[r.attack_type]}</span>
                      {r.caught ? (
                        <ToneBadge tone="success" icon={ShieldCheck}>
                          Caught
                        </ToneBadge>
                      ) : (
                        <ToneBadge tone="danger" icon={ShieldAlert}>
                          Slipped through
                        </ToneBadge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        pipeline → <span className="font-medium text-foreground">{r.status.replace("_", " ")}</span>
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">{formatTime(r.created_at)}</span>
                    </div>
                    {layers.length ? (
                      <p className="text-sm">
                        Caught by: <span className="font-medium">{layers.map((l) => l.label).join(", ")}</span>
                      </p>
                    ) : null}
                    {r.reason_codes.length ? (
                      <div className="flex flex-wrap gap-1">
                        {r.reason_codes.map((c) => (
                          <ReasonCode key={c} code={c} />
                        ))}
                      </div>
                    ) : null}
                    {checks.length ? <CheckTable checks={checks} fillMissing={false} /> : null}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
