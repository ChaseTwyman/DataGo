"use client";
import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { LenientSubmissionWithMedia as SubmissionWithMedia } from "@groundtruth/shared";
import { Checkbox } from "@/components/ds/controls";
import { ReviewBrief } from "@/components/grokbot/ReviewBrief";
import { Empty, ErrorBox, Loading, PageHeader } from "@/components/page";
import { SubmissionCard } from "@/components/submissions/SubmissionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { api, errorMessage } from "@/lib/client/api";
import { useSubmissionStream } from "@/lib/client/realtime";

export default function ReviewPage() {
  const stream = useSubmissionStream({ status: "needs_review", limit: 100 });
  return (
    <>
      <PageHeader
        title="Review queue"
        description="Submissions the pipeline couldn't decide on. Approving pays the locked quote; rejecting for integrity lowers the contributor's trust score."
      />
      <div className="mx-auto w-full max-w-5xl space-y-3 p-6">
        <ErrorBox message={stream.error} />
        {stream.loading ? <Loading /> : null}
        {!stream.loading && stream.submissions.length === 0 ? (
          <Empty title="Queue is empty">Nothing needs a human right now.</Empty>
        ) : null}
        {stream.submissions.map((s) => (
          <SubmissionCard
            key={s.id}
            s={s}
            showBounty
            defaultOpen={stream.submissions.length <= 3}
            fresh={stream.freshIds.includes(s.id)}
            brief={false}
            actions={
              // Narrow screens stack the decision first, so the brief is never above the buttons.
              <div className="grid w-full grid-cols-1 gap-3 py-1 md:grid-cols-[minmax(0,1fr)_300px]">
                <ReviewBrief submissionId={s.id} autoLoad={stream.submissions.length <= 3} />
                <ReviewActions s={s} onDone={() => { stream.remove(s.id); void stream.refresh(); }} />
              </div>
            }
          />
        ))}
      </div>
    </>
  );
}

function ReviewActions({ s, onDone }: { s: SubmissionWithMedia; onDone: () => void }) {
  const [integrity, setIntegrity] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (decision: "approve" | "reject") => {
    setBusy(decision);
    setError(null);
    try {
      await api.review(s.id, decision, integrity, note.trim() || undefined);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <div className="order-first flex w-full flex-col gap-2 md:order-last md:border-l md:pl-3">
      <div className="caps text-[11px] font-semibold">Your decision</div>
      {/* Both buttons look the same on purpose: nothing on this page leans toward either outcome. */}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void act("approve")}>
          {busy === "approve" ? <LoaderCircle className="animate-spin" aria-hidden /> : <CircleCheck aria-hidden />}
          Approve &amp; pay
        </Button>
        <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void act("reject")}>
          {busy === "reject" ? <LoaderCircle className="animate-spin" aria-hidden /> : <CircleX aria-hidden />}
          Reject
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        <Checkbox
          className="items-start text-xs"
          checked={integrity}
          onChange={(e) => setIntegrity(e.target.checked)}
          label="Integrity issue (fraud/fake — larger trust penalty)"
        />
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note"
          maxLength={500}
          className="h-8 text-xs"
          aria-label="Review note"
        />
      </div>
      <ErrorBox message={error} />
    </div>
  );
}
