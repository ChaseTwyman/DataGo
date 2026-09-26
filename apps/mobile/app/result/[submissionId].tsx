/**
 * Verification screen (PRD §7.5): per-stage checklist animating from realtime updates (or 1 s
 * polling), then accepted (amount counts up) / needs review / protocol reject with one-tap retry /
 * integrity reject with the neutral message only.
 */
import {
  ChecksSchema,
  formatCents,
  pendingChecks,
  ReasonCodeSchema,
  SubmissionStatusSchema,
  type StageResult,
  type StageStatus,
} from "@groundtruth/shared";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Animated, ScrollView, Text, View } from "react-native";
import { z } from "zod";
import { api } from "../../src/api";
import { resultView, watchSubmission } from "../../src/api/submissionWatch";
import { getSupabase } from "../../src/lib/supabase";
import { preciseFix } from "../../src/lib/useUserLocation";
import { useApp } from "../../src/state/appStore";
import { canRetryInSession, findCaptureBySubmission, useCaptureStore } from "../../src/state/captureStore";
import { Button, Card, H, Muted, StatusPill, type Tone } from "../../src/ui/components";
import { C, S } from "../../src/ui/theme";
import { useCountUp } from "../../src/ui/useCountUp";

/** The subset of a submission row the phone renders (realtime rows are parsed leniently). */
const ViewRowSchema = z.object({
  status: SubmissionStatusSchema,
  checks: ChecksSchema.catch([]),
  reason_codes: z.array(ReasonCodeSchema).catch([]),
  payout_cents: z.number().int().nullable().catch(null),
  retryable: z.boolean().optional(),
  bounty_title: z.string().nullable().optional(),
});
type ViewRow = z.infer<typeof ViewRowSchema>;

const STAGE_TONE: Record<StageStatus, { tone: Tone; text: string }> = {
  pending: { tone: "neutral", text: "Waiting" },
  running: { tone: "info", text: "Checking…" },
  pass: { tone: "ok", text: "Passed" },
  warn: { tone: "warn", text: "Warning" },
  fail: { tone: "bad", text: "Failed" },
  waived: { tone: "info", text: "Waived (demo)" },
  skipped: { tone: "neutral", text: "Skipped" },
  error: { tone: "warn", text: "Needs a human" },
};

export default function ResultScreen() {
  const { submissionId } = useLocalSearchParams<{ submissionId: string }>();
  const realtime = useApp((s) => s.health?.realtime === true && s.authMode === "supabase");
  const [row, setRow] = useState<ViewRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const capture = useCaptureStore(() => (submissionId ? findCaptureBySubmission(submissionId) : null));
  const put = useCaptureStore((s) => s.put);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!submissionId) return;
    return watchSubmission<ViewRow>({
      fetchOnce: async () => ViewRowSchema.parse(await api.submission(submissionId)),
      subscribe: realtime
        ? (onRow) => {
            const sb = getSupabase();
            const ch = sb
              .channel(`submission:${submissionId}`)
              .on("postgres_changes", { event: "UPDATE", schema: "public", table: "submissions", filter: `id=eq.${submissionId}` }, (payload) => {
                const parsed = ViewRowSchema.safeParse(payload.new);
                if (parsed.success) onRow(parsed.data);
              })
              .subscribe();
            return () => void sb.removeChannel(ch);
          }
        : null,
      onUpdate: (r) => {
        setErr(null);
        setRow((prev) => ({ ...r, retryable: r.retryable ?? prev?.retryable, bounty_title: r.bounty_title ?? prev?.bounty_title }));
      },
      onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
    });
  }, [realtime, submissionId]);

  const view = row
    ? resultView(row, capture?.session.protocol ?? null, { sessionOpen: true, serverRetryable: row.retryable })
    : resultView({ status: "pending", reason_codes: [], payout_cents: null }, null);
  const payout = useCountUp(view.kind === "accepted" ? (row?.payout_cents ?? 0) : null, 1600, 0);

  const buzzed = useRef(false);
  useEffect(() => {
    if (buzzed.current || view.kind === "verifying") return;
    buzzed.current = true;
    void Haptics.notificationAsync(
      view.kind === "accepted" ? Haptics.NotificationFeedbackType.Success : view.kind === "needs_review" ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Error,
    );
  }, [view.kind]);

  const checks: StageResult[] = row?.checks.length ? row.checks : pendingChecks();

  const retry = async () => {
    if (!capture) return router.replace("/foryou");
    if (canRetryInSession(capture)) return router.replace(`/capture/${capture.session.session_id}`);
    // Server issues one upload slot per frame and one submission per session: a retry opens a new session.
    setRetrying(true);
    try {
      const b = capture.bounty;
      const fix = await preciseFix();
      const session = await api.createSession({ bounty_id: b.id, lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracyM ?? 999 });
      put({ session, bounty: b });
      router.replace(`/capture/${session.session_id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: S.lg, gap: S.lg, paddingBottom: 48 }}>
      <Card style={{ gap: S.sm, alignItems: "center", paddingVertical: S.xl, borderColor: headerColor(view.kind) }}>
        <Text style={{ color: headerColor(view.kind), fontSize: 28, fontWeight: "900" }}>{view.title}</Text>
        {view.kind === "accepted" && payout !== null ? (
          <Text style={{ color: C.green, fontSize: 48, fontWeight: "900", fontVariant: ["tabular-nums"] }}>+{formatCents(payout)}</Text>
        ) : null}
        {view.kind === "accepted" ? <Muted>Locked price × quality multiplier, credited to your wallet.</Muted> : null}
        {view.messages.map((m) => (
          <Text key={m} style={{ color: C.text, fontSize: 16, textAlign: "center" }}>
            {m}
          </Text>
        ))}
      </Card>

      <Card style={{ gap: S.md }}>
        <H size={17}>Verification</H>
        {checks.map((c, i) => (
          <StageRow key={c.stage} stage={c} index={i} hideDetail={view.kind === "integrity_reject"} />
        ))}
      </Card>

      {err ? <StatusPill tone="warn" text={`Connection: ${err}`} /> : null}

      {view.kind === "protocol_reject" && view.retryable ? (
        <Button title="Retry capture" icon="↻" onPress={() => void retry()} loading={retrying} />
      ) : null}
      {view.kind !== "verifying" ? (
        <Button title={view.kind === "accepted" ? "See wallet" : "Back to bounties"} kind="secondary" onPress={() => router.replace(view.kind === "accepted" ? "/wallet" : "/foryou")} />
      ) : null}
    </ScrollView>
  );
}

function headerColor(kind: string): string {
  return kind === "accepted" ? C.green : kind === "needs_review" ? C.amber : kind === "verifying" ? C.blue : C.red;
}

function StageRow({ stage, index, hideDetail }: { stage: StageResult; index: number; hideDetail: boolean }) {
  const fade = useRef(new Animated.Value(0)).current;
  const status = stage.status;
  useEffect(() => {
    fade.setValue(0.3);
    Animated.timing(fade, { toValue: 1, duration: 350, delay: index * 60, useNativeDriver: true }).start();
  }, [fade, index, status]);
  // Integrity rejects never reveal which layer fired: every finished stage reads the same.
  const t = hideDetail ? { tone: "neutral" as Tone, text: status === "pending" || status === "running" ? "…" : "Checked" } : STAGE_TONE[status];
  return (
    <Animated.View style={{ opacity: fade, flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 36, gap: S.sm }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.text, fontSize: 15, fontWeight: "600" }}>{stage.label}</Text>
        {!hideDetail && stage.status === "waived" ? <Muted>Weather check waived (demo)</Muted> : null}
      </View>
      <StatusPill tone={t.tone} text={t.text} />
    </Animated.View>
  );
}
