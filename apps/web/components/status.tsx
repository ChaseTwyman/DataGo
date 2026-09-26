import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CircleX,
  Clock,
  Info,
  LoaderCircle,
  Pause,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { BountyStatus, StageStatus } from "@groundtruth/shared";
import {
  reasonTone,
  STAGE_STATUS_META,
  SUBMISSION_STATUS_META,
  type SubmissionStatus,
  type Tone,
} from "@/lib/client/checkFormat";
import { cn } from "@/lib/client/cn";
import { Badge } from "./ui/badge";

const STAGE_ICON: Record<StageStatus, LucideIcon> = {
  pending: CircleDashed,
  running: LoaderCircle,
  pass: CircleCheck,
  warn: TriangleAlert,
  fail: CircleX,
  waived: Info,
  skipped: CircleMinus,
  error: CircleAlert,
};

const SUBMISSION_ICON: Record<SubmissionStatus, LucideIcon> = {
  pending: Clock,
  verifying: LoaderCircle,
  accepted: CircleCheck,
  rejected: CircleX,
  needs_review: TriangleAlert,
};

const humanize = (s: string) => {
  const w = s.replace(/_/g, " ").trim();
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : "Unknown";
};

/** Icon + color + text, never color alone (BUILD_PROMPT §8 accessibility). */
export function StageStatusBadge({ status }: { status: StageStatus | (string & {}) }) {
  // Unknown statuses (newer server) render neutrally with their own name.
  const meta = STAGE_STATUS_META[status as StageStatus] ?? { label: status.replace(/_/g, " "), tone: "muted" as Tone };
  const Icon = STAGE_ICON[status as StageStatus] ?? CircleDashed;
  return (
    <Badge tone={meta.tone}>
      <Icon className={cn(status === "running" && "animate-spin")} aria-hidden />
      {meta.label}
    </Badge>
  );
}

export function SubmissionStatusBadge({ status, className }: { status: SubmissionStatus | (string & {}); className?: string }) {
  const meta = SUBMISSION_STATUS_META[status as SubmissionStatus] ?? { label: humanize(status), tone: "muted" as Tone };
  const Icon = SUBMISSION_ICON[status as SubmissionStatus] ?? Clock;
  return (
    <Badge tone={meta.tone} className={className}>
      <Icon className={cn(status === "verifying" && "animate-spin")} aria-hidden />
      {meta.label}
    </Badge>
  );
}

export function ReasonCode({ code }: { code: string }) {
  return (
    <Badge tone={reasonTone(code)} className="font-mono">
      {code}
    </Badge>
  );
}

export function ToneBadge({ tone, icon: Icon, children }: { tone: Tone; icon?: LucideIcon; children: ReactNode }) {
  return (
    <Badge tone={tone}>
      {Icon ? <Icon aria-hidden /> : null}
      {children}
    </Badge>
  );
}

const BOUNTY_META: Record<BountyStatus, { label: string; tone: Tone; icon: LucideIcon }> = {
  active: { label: "Active", tone: "success", icon: CircleCheck },
  paused: { label: "Paused", tone: "warning", icon: Pause },
  draft: { label: "Draft", tone: "muted", icon: CircleDashed },
  closed: { label: "Closed", tone: "muted", icon: CircleMinus },
};

export function BountyStatusBadge({ status }: { status: BountyStatus | (string & {}) }) {
  const m = BOUNTY_META[status as BountyStatus] ?? { label: humanize(status), tone: "muted" as Tone, icon: CircleDashed };
  return (
    <Badge tone={m.tone}>
      <m.icon aria-hidden />
      {m.label}
    </Badge>
  );
}
