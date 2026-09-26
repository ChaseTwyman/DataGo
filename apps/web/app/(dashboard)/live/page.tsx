"use client";
import { Radio } from "lucide-react";
import { useMemo } from "react";
import { formatCents } from "@groundtruth/shared";
import { Empty, ErrorBox, Loading, PageHeader, Stat } from "@/components/page";
import { SubmissionCard } from "@/components/submissions/SubmissionCard";
import { useSubmissionStream } from "@/lib/client/realtime";

/** Every submission across the researcher's bounties, newest first. */
export default function LivePage() {
  const stream = useSubmissionStream({ limit: 100 });
  const stats = useMemo(() => {
    const s = stream.submissions;
    return {
      total: s.length,
      accepted: s.filter((x) => x.status === "accepted").length,
      review: s.filter((x) => x.status === "needs_review").length,
      rejected: s.filter((x) => x.status === "rejected").length,
      paid: s.reduce((sum, x) => sum + (x.status === "accepted" ? (x.payout_cents ?? 0) : 0), 0),
    };
  }, [stream.submissions]);

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Radio className="size-4 text-red-500" aria-hidden /> Live
          </span>
        }
        description={`All active bounties · ${stream.mode === "realtime" ? "realtime updates" : "polling every 2 s"}`}
      />
      <div className="grid grid-cols-2 gap-4 border-b bg-card px-6 py-3 sm:grid-cols-5">
        <Stat label="Recent" value={stats.total} />
        <Stat label="Accepted" value={stats.accepted} />
        <Stat label="Needs review" value={stats.review} />
        <Stat label="Rejected" value={stats.rejected} />
        <Stat label="Paid out" value={formatCents(stats.paid)} />
      </div>
      <div className="mx-auto w-full max-w-4xl space-y-2 p-6">
        <ErrorBox message={stream.error} />
        {stream.loading ? <Loading /> : null}
        {!stream.loading && stream.submissions.length === 0 ? (
          <Empty title="No submissions yet">Captures from the field show up here as they are verified.</Empty>
        ) : null}
        {stream.submissions.map((s) => (
          <SubmissionCard key={s.id} s={s} showBounty fresh={stream.freshIds.includes(s.id)} />
        ))}
      </div>
    </>
  );
}
