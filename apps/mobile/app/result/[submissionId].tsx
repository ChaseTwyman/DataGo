/**
 * Verification screen (PRD §7.5): per-stage checklist animating from realtime updates (or 1 s
 * polling), then accepted (amount counts up) / needs review / protocol reject with one-tap retry /
 * integrity reject with the neutral message only.
 */
import {
  LenientChecksSchema,
  lenientArray,
  openString,
  pendingChecks,
  stageLabel,
  type LenientStageResult,
  type StageStatus,
} from "@groundtruth/shared";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { z } from "zod";
import { api, ApiError } from "../../src/api";
import { isTransient, toUserMessage } from "../../src/api/errors";
import { resultView, watchSubmission, type ResultKind } from "../../src/api/submissionWatch";
import { ShareImpactCard } from "../../src/impact/ShareImpactCard";
import { log } from "../../src/lib/log";
import { getSupabase } from "../../src/lib/supabase";
import { preciseFix } from "../../src/lib/useUserLocation";
import { useApp } from "../../src/state/appStore";
import { canRetryInSession, findCaptureBySubmission, useCaptureStore } from "../../src/state/captureStore";
import { GrokbotCard, NarrationCaptions } from "../../src/grokbot/GrokbotCard";
import { explainErrorText, grokbotCardView } from "../../src/grokbot/messageView";
import type { LenientGrokbotMessage } from "../../src/grokbot/schemas";
import { useVerificationCompanion, type CompanionVoice } from "../../src/grokbot/useVerificationCompanion";
import { Body, Button, Divider, Heading, Icon, IconButton, Label, Money, Section, StatusPill, toneColor, type IconName, type Tone } from "../../src/ui/components";
import { indexLabel } from "../../src/ui/telemetry";
import { C, F, S, T } from "../../src/ui/theme";
import { useCountUp } from "../../src/ui/useCountUp";

const VOICE_PILL: Record<Exclude<CompanionVoice, "off">, { tone: Tone; icon: IconName; text: string }> = {
  connecting: { tone: "neutral", icon: "radio", text: "Voice connecting" },
  speaking: { tone: "info", icon: "volume-2", text: "Grokbot speaking" },
  ready: { tone: "ok", icon: "volume-1", text: "Voice on" },
  unavailable: { tone: "neutral", icon: "volume-x", text: "Voice unavailable · captions only" },
};

/**
 * The subset of a submission row the phone renders. Lenient on purpose (API responses AND realtime
 * rows): stages, statuses and reason codes added by a newer server render generically.
 */
const ViewRowSchema = z.object({
  status: openString(),
  checks: LenientChecksSchema,
  reason_codes: lenientArray(z.string()),
  payout_cents: z.number().int().nullable().catch(null),
  retryable: z.boolean().optional().catch(undefined),
  bounty_title: z.string().nullable().optional().catch(undefined),
});
type ViewRow = z.infer<typeof ViewRowSchema>;

/** After this long still "verifying", reassure and let the contributor leave. */
const LONG_WAIT_MS = 90_000;

const UNKNOWN_STAGE_TONE = { tone: "neutral" as Tone, text: "Checked" };

const STAGE_TONE: Record<StageStatus, { tone: Tone; text: string }> = {
  pending: { tone: "neutral", text: "Waiting" },
  running: { tone: "info", text: "Checking" },
  pass: { tone: "ok", text: "Passed" },
  warn: { tone: "warn", text: "Warning" },
  fail: { tone: "bad", text: "Failed" },
  waived: { tone: "info", text: "Waived (demo)" },
  skipped: { tone: "neutral", text: "Skipped" },
  error: { tone: "warn", text: "Needs a human" },
};

const HEADER: Record<ResultKind, { tone: Tone; icon: IconName }> = {
  verifying: { tone: "info", icon: "loader" },
  accepted: { tone: "ok", icon: "check-circle" },
  needs_review: { tone: "warn", icon: "clock" },
  protocol_reject: { tone: "bad", icon: "rotate-ccw" },
  integrity_reject: { tone: "bad", icon: "x-circle" },
};

export { RouteErrorBoundary as ErrorBoundary } from "../../src/ui/ErrorFallback";

export default function ResultScreen() {
  const { submissionId, voice: voiceParam } = useLocalSearchParams<{ submissionId: string; voice?: string }>();
  const insets = useSafeAreaInsets();
  // Voice follows the capture screen's toggle (?voice=0 when the guide was turned off there).
  const integrityRef = useRef(false);
  const companion = useVerificationCompanion(submissionId, { voice: voiceParam !== "0", integrityRef });
  const [explained, setExplained] = useState<LenientGrokbotMessage | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const realtime = useApp((s) => s.health?.realtime === true && s.authMode === "supabase");
  const [row, setRow] = useState<ViewRow | null>(null);
  /** Background fetch trouble: shown as a subtle "reconnecting" line while retries continue. */
  const [reconnecting, setReconnecting] = useState(false);
  /** A failure retrying can't fix (e.g. the submission doesn't exist): calm message + way out. */
  const [fatal, setFatal] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), LONG_WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  const capture = useCaptureStore(() => (submissionId ? findCaptureBySubmission(submissionId) : null));
  const put = useCaptureStore((s) => s.put);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!submissionId) return;
    return watchSubmission<ViewRow>({
      fetchOnce: async () => {
        const parsed = ViewRowSchema.safeParse(await api.submission(submissionId));
        if (!parsed.success) throw new ApiError(200, "CONTRACT_MISMATCH", "submission view row");
        return parsed.data;
      },
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
        setReconnecting(false);
        setRow((prev) => ({ ...r, retryable: r.retryable ?? prev?.retryable, bounty_title: r.bounty_title ?? prev?.bounty_title }));
      },
      onError: (e) => {
        log.handled("result-watch", e);
        if (isTransient(e)) {
          setReconnecting(true);
          return;
        }
        setFatal(toUserMessage(e).message);
        return "stop";
      },
    });
  }, [realtime, submissionId]);

  const view = row
    ? resultView(row, capture?.session.protocol ?? null, { sessionOpen: true, serverRetryable: row.retryable })
    : resultView({ status: "pending", reason_codes: [], payout_cents: null }, null);
  integrityRef.current = view.kind === "integrity_reject";
  const payout = useCountUp(view.kind === "accepted" ? (row?.payout_cents ?? 0) : null, 1600, 0);

  const buzzed = useRef(false);
  useEffect(() => {
    if (buzzed.current || view.kind === "verifying") return;
    buzzed.current = true;
    void Haptics.notificationAsync(
      view.kind === "accepted" ? Haptics.NotificationFeedbackType.Success : view.kind === "needs_review" ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Error,
    );
  }, [view.kind]);

  const checks: LenientStageResult[] = row?.checks.length ? row.checks : pendingChecks();

  const retry = async () => {
    if (!capture) return router.replace("/foryou");
    if (canRetryInSession(capture)) return router.replace(`/capture/${capture.session.session_id}`);
    // Server issues one upload slot per frame and one submission per session: a retry opens a new session.
    setRetrying(true);
    setRetryError(null);
    try {
      const b = capture.bounty;
      const fix = await preciseFix();
      const session = await api.createSession({ bounty_id: b.id, lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracyM ?? 999 });
      put({ session, bounty: b });
      router.replace(`/capture/${session.session_id}`);
    } catch (e) {
      log.handled("result-retry", e);
      setRetryError(toUserMessage(e).message);
    } finally {
      setRetrying(false);
    }
  };

  const explain = async () => {
    if (!submissionId) return;
    setExplaining(true);
    setExplainError(null);
    try {
      setExplained(await api.explain(submissionId));
    } catch (e) {
      log.handled("result-explain", e);
      setExplainError(explainErrorText(e));
    } finally {
      setExplaining(false);
    }
  };

  const head = HEADER[view.kind];
  const color = toneColor(head.tone);
  const hideDetail = view.kind === "integrity_reject";
  const done = checks.filter((c) => c.status !== "pending" && c.status !== "running").length;
  const terminal = view.kind !== "verifying";
  // The final narration if there is one, else an on-demand explanation.
  const message = companion.final ?? explained;
  const card = message && terminal ? grokbotCardView(message, { integrityReject: hideDetail }) : null;
  const pill = companion.voiceState === "off" ? null : VOICE_PILL[companion.voiceState];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ padding: S.lg, gap: S.xxl, paddingBottom: S.xxl }}>
        <View style={{ gap: S.md, paddingTop: S.md }} accessibilityLiveRegion="polite">
          <View style={{ flexDirection: "row", alignItems: "center", gap: S.sm }}>
            {view.kind === "verifying" ? <ActivityIndicator color={color} /> : <Icon name={head.icon} size={22} color={color} />}
            <Heading size={T.heading} color={color} style={{ flex: 1 }}>
              {view.title}
            </Heading>
            {companion.live ? (
              <IconButton
                icon={companion.muted ? "volume-x" : "volume-2"}
                label={companion.muted ? "Turn Grokbot voice on" : "Mute Grokbot voice"}
                role="switch"
                checked={!companion.muted}
                color={companion.muted ? C.amber : C.text}
                onPress={() => companion.setMuted(!companion.muted)}
              />
            ) : null}
          </View>
          {row?.bounty_title ? <Label>{row.bounty_title}</Label> : null}
          {view.kind === "accepted" && payout !== null ? (
            <View style={{ gap: S.xs }}>
              <Money cents={payout} size={T.numeralHero} prefix="+" />
              <Label>Locked price × quality · credited to your wallet</Label>
            </View>
          ) : null}
          {view.kind === "accepted" && submissionId ? <ShareImpactCard submissionId={submissionId} /> : null}
          {view.messages.map((m) => (
            <Body key={m}>{m}</Body>
          ))}
        </View>

        {companion.lines.length || card || terminal ? (
          <Section title="Grokbot" right={pill ? <StatusPill tone={pill.tone} icon={pill.icon} text={pill.text} /> : undefined}>
            <NarrationCaptions lines={companion.lines} />
            {card ? <GrokbotCard view={card} label={companion.final ? "Grokbot · result" : "Grokbot · explanation"} /> : null}
            {terminal && !card ? (
              <View style={{ gap: S.sm }}>
                {explainError ? <StatusPill tone="neutral" icon="info" text={explainError} /> : null}
                <Button title="Explain this result" kind="secondary" icon="help-circle" onPress={() => void explain()} loading={explaining} />
              </View>
            ) : null}
          </Section>
        ) : null}

        <Section title="Verification" right={<Label>{hideDetail ? "" : `${done}/${checks.length}`}</Label>}>
          <View>
            {checks.map((c, i) => (
              <View key={c.stage}>
                {i > 0 ? <Divider /> : null}
                <StageRow stage={c} index={i} hideDetail={hideDetail} />
              </View>
            ))}
          </View>
        </Section>

        {reconnecting && !fatal ? <StatusPill tone="neutral" text="Reconnecting… your result is safe" icon="wifi-off" /> : null}
        {fatal ? <StatusPill tone="warn" text={fatal} icon="info" /> : null}
        {slow && view.kind === "verifying" && !fatal ? (
          <Body color={C.muted} size={T.bodySmall}>
            Still verifying — this can take a couple of minutes. You can leave this screen; your wallet updates when it&apos;s done.
          </Body>
        ) : null}
      </ScrollView>

      {view.kind !== "verifying" || fatal || slow ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + S.md }]}>
          {retryError ? <StatusPill tone="bad" text={retryError} /> : null}
          {view.kind === "protocol_reject" && view.retryable ? (
            <Button title="Retry capture" icon="rotate-ccw" onPress={() => void retry()} loading={retrying} />
          ) : null}
          <Button
            title={view.kind === "accepted" ? "See wallet" : "Back to bounties"}
            kind={view.kind === "protocol_reject" && view.retryable ? "secondary" : "primary"}
            icon={view.kind === "accepted" ? "credit-card" : "arrow-left"}
            onPress={() => router.replace(view.kind === "accepted" ? "/wallet" : "/foryou")}
          />
        </View>
      ) : null}
    </View>
  );
}

function StageRow({ stage, index, hideDetail }: { stage: LenientStageResult; index: number; hideDetail: boolean }) {
  const fade = useRef(new Animated.Value(0)).current;
  const status = stage.status;
  useEffect(() => {
    fade.setValue(0.3);
    Animated.timing(fade, { toValue: 1, duration: 350, delay: index * 60, useNativeDriver: true }).start();
  }, [fade, index, status]);
  // Integrity rejects never reveal which layer fired: every finished stage reads the same.
  const t = hideDetail
    ? { tone: "neutral" as Tone, text: status === "pending" || status === "running" ? "…" : "Checked" }
    : (STAGE_TONE[status as StageStatus] ?? UNKNOWN_STAGE_TONE);
  return (
    <Animated.View style={{ opacity: fade, flexDirection: "row", alignItems: "center", minHeight: 52, gap: S.md, paddingVertical: S.sm }}>
      <Text style={styles.index}>{indexLabel(index)}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.text, fontFamily: F.bodyMedium, fontSize: T.body }}>{stageLabel(stage.stage, stage.label)}</Text>
        {!hideDetail && stage.status === "waived" ? <Label>Weather check waived (demo)</Label> : null}
      </View>
      {status === "running" && !hideDetail ? <ActivityIndicator color={C.blue} size="small" /> : null}
      <StatusPill tone={t.tone} text={t.text} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  index: { color: C.muted, fontFamily: F.numeralRegular, fontSize: T.body, fontVariant: ["tabular-nums"], minWidth: 22 },
  footer: { paddingHorizontal: S.lg, paddingTop: S.md, gap: S.sm, backgroundColor: C.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.hairline },
});
