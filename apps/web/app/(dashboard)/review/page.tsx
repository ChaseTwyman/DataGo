"use client";
import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { LenientSubmissionWithMedia as SubmissionWithMedia } from "@groundtruth/shared";
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
      <div className="mx-auto w-full max-w-4xl space-y-3 p-6">
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
            actions={<ReviewActions s={s} onDone={() => { stream.remove(s.id); void stream.refresh(); }} />}
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
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="success" size="sm" disabled={busy !== null} onClick={() => void act("approve")}>
          {busy === "approve" ? <LoaderCircle className="animate-spin" aria-hidden /> : <CircleCheck aria-hidden />}
          Approve &amp; pay
        </Button>
        <Button variant="destructive" size="sm" disabled={busy !== null} onClick={() => void act("reject")}>
          {busy === "reject" ? <LoaderCircle className="animate-spin" aria-hidden /> : <CircleX aria-hidden />}
          Reject
        </Button>
        <label className="flex h-8 items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="size-4"
            checked={integrity}
            onChange={(e) => setIntegrity(e.target.checked)}
          />
          Integrity issue (fraud/fake — larger trust penalty)
        </label>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note"
          maxLength={500}
          className="h-8 min-w-40 flex-1 text-xs"
          aria-label="Review note"
        />
      </div>
      <ErrorBox message={error} />
    </div>
  );
}
