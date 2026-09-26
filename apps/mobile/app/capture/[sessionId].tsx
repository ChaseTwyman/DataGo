/**
 * Guided capture (PRD §7.4): full-bleed camera, bottom-sheet checklist, locked shutter showing the
 * single most important missing item, voice guide with captions always visible. The shutter button
 * and the voice `trigger_capture` tool go through the same `gate.trigger()`.
 */
import type { CreateSubmissionRequest, FieldQuestion } from "@groundtruth/shared";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Camera, useCameraPermission, usePhotoOutput, type CameraRef } from "react-native-vision-camera";
import { api } from "../../src/api";
import { toUserMessage, UserFacingError } from "../../src/api/errors";
import { CHALLENGE_LEAD_MS, runBurst, sensorSnapshot, toMediaItems, type CapturedFrame } from "../../src/capture/burst";
import { ChecklistOverlay } from "../../src/capture/ChecklistOverlay";
import { deviceInfo, photoCapturer, uploadJpeg } from "../../src/capture/nativeCapture";
import { isPreCapture } from "../../src/capture/gateMachine";
import { uploadFrames } from "../../src/capture/upload";
import { useCaptureGate } from "../../src/capture/useCaptureGate";
import { log } from "../../src/lib/log";
import { shouldQueue } from "../../src/offline/queue";
import { queueChanged, uploadQueue } from "../../src/offline/runtime";
import { useCaptureStore, type ActiveCapture } from "../../src/state/captureStore";
import { Body, Button, Heading, Icon, IconButton, Label, PermissionNeeded, StatusPill } from "../../src/ui/components";
import { countdownLabel, indexLabel, tPlus } from "../../src/ui/telemetry";
import { C, F, R, S, T, TOUCH, TRACK } from "../../src/ui/theme";
import { CaptionList } from "../../src/voice/CaptionList";
import { CAPTURE_DONE_RESPONSE_INSTRUCTIONS } from "../../src/voice/instructions";
import type { ToolContext } from "../../src/voice/tools";
import { useGrokVoice } from "../../src/voice/useGrokVoice";

export { RouteErrorBoundary as ErrorBoundary } from "../../src/ui/ErrorFallback";

export default function CaptureScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const active = useCaptureStore((s) => (sessionId ? s.bySession[sessionId] : undefined));
  const perm = useCameraPermission();

  const { hasPermission, canRequestPermission, requestPermission } = perm;
  useEffect(() => {
    if (!hasPermission && canRequestPermission) void requestPermission().catch(() => undefined);
  }, [hasPermission, canRequestPermission, requestPermission]);

  if (!active) {
    return (
      <View style={[styles.center, { padding: S.xl, gap: S.lg }]}>
        <Icon name="slash" size={28} color={C.muted} />
        <Heading size={T.title}>Session unavailable</Heading>
        <Body color={C.muted}>This capture session has ended or expired. Start a new one from the bounty briefing.</Body>
        <Button title="Back to bounties" icon="arrow-left" onPress={() => router.replace("/foryou")} />
      </View>
    );
  }
  if (!perm.hasPermission) {
    return (
      <View style={styles.center}>
        <PermissionNeeded
          icon="camera-off"
          title="Camera access needed"
          body={
            perm.canRequestPermission
              ? "GroundTruth only takes photos inside the app. Nothing is imported from your library."
              : "Camera access is off for GroundTruth. Turn it on in Settings, then come back — your session stays open for a few minutes."
          }
          canAsk={perm.canRequestPermission}
          onAsk={() => void perm.requestPermission().catch(() => undefined)}
          secondary={<Button title="Cancel" kind="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace("/foryou"))} style={{ alignSelf: "stretch" }} />}
        />
      </View>
    );
  }
  return <CaptureInner active={active} />;
}

function CaptureInner({ active }: { active: ActiveCapture }) {
  const { session, bounty } = active;
  const protocol = session.protocol;
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraRef>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const photoOutput = usePhotoOutput({ containerFormat: "jpeg", quality: 0.92, qualityPrioritization: "balanced" });
  const gate = useCaptureGate({ protocol, bounty, session, cameraRef, cameraReady });
  const { state, send } = gate;
  const framesRef = useRef<CapturedFrame[]>([]);
  /** Indexes of framesRef already uploaded (reset on every new burst). */
  const uploadedRef = useRef<Set<number>>(new Set());
  const [burstError, setBurstError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** The capture was saved to the upload queue (no signal); it sends itself later. */
  const [queued, setQueued] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  /** Read by submit: the result screen's companion stays quiet if the guide was turned off here. */
  const voiceOnRef = useRef(voiceOn);
  voiceOnRef.current = voiceOn;
  const markSubmitted = useCaptureStore((s) => s.markSubmitted);

  // ---------------- submit (upload frames → POST /api/submissions → result)
  const submitting = useRef(false);
  const submit = useCallback(async () => {
    if (submitting.current) return;
    const s = gate.stateRef.current;
    if (s.phase !== "notes") return;
    submitting.current = true;
    send({ type: "SUBMIT" });
    setSubmitError(null);
    try {
      const frames = framesRef.current;
      const slots = session.uploads.slice(active.usedUploads, active.usedUploads + frames.length);
      if (slots.length < frames.length)
        throw new UserFacingError("This session has no photo slots left. Go back to the briefing and start a new capture.", "Session used up", false);
      const raw = gate.device.raw.current;
      if (raw.lat === null || raw.lng === null)
        throw new UserFacingError("Waiting for a GPS fix. Stay where you took the photos and tap Submit again.", "No GPS fix");
      const request: CreateSubmissionRequest = {
        session_id: session.session_id,
        nonce: session.nonce,
        media: toMediaItems(frames, slots.map((u) => u.path)),
        lat: raw.lat,
        lng: raw.lng,
        accuracy_m: raw.accuracyM ?? 999,
        captured_at: frames[0]?.capturedAt ?? new Date().toISOString(),
        device: deviceInfo(),
        sensors: sensorSnapshot(raw.tiltDeg, raw.rotationRate, raw.steady, raw.headingDeg),
        field_notes: gate.stateRef.current.notes,
        gate: {
          // No degraded unlock any more: the shutter only opens on the server's gate_passed.
          degraded: false,
          server_gate_passed: s.serverGatePassed,
          frame_checks: s.frameChecks,
          consecutive_green: s.greenStreak,
          last_hint: s.lastHint,
        },
      };
      let res: { submission_id: string };
      try {
        // Per-frame retries with backoff; frames already uploaded are skipped on "Try again".
        await uploadFrames(frames, slots, uploadedRef.current, (f, slot) => uploadJpeg(f.uri, slot));
        res = await api.createSubmission(request);
      } catch (e) {
        // Signal dropped AFTER a gate-passed burst: keep the capture on the phone and send it when
        // signal returns (the server accepts it within its grace). Never for a session whose gate
        // didn't pass, and never for a refusal — those surface as errors as before.
        if (!s.serverGatePassed || !shouldQueue(e)) throw e;
        await uploadQueue.enqueue({
          sessionId: session.session_id,
          bountyTitle: bounty.title,
          sessionExpiresAt: session.expires_at,
          frames: frames.map((f, i) => ({ uri: f.uri, slot: slots[i]! })),
          uploaded: [...uploadedRef.current],
          request,
        });
        queueChanged();
        send({ type: "UPLOAD_DONE" });
        setQueued(true);
        return;
      }
      markSubmitted(session.session_id, res.submission_id, frames.length);
      send({ type: "UPLOAD_DONE" });
      router.replace(`/result/${res.submission_id}${voiceOnRef.current ? "" : "?voice=0"}`);
    } catch (e) {
      // Frames stay in framesRef (and uploaded ones in uploadedRef): Submit retries without re-shooting.
      log.handled("submit", e);
      send({ type: "UPLOAD_FAILED", message: "submit failed" });
      setSubmitError(toUserMessage(e).message);
    } finally {
      submitting.current = false;
    }
  }, [active.usedUploads, bounty.title, gate.device.raw, gate.stateRef, markSubmitted, send, session]);

  // ---------------- voice guide
  const toolContext: ToolContext = useMemo(
    () => ({
      protocol,
      getStatus: () => {
        const s = gate.stateRef.current;
        const cs = gate.cameraStatus;
        return {
          phase: s.phase,
          ready: s.phase === "ready",
          missing: cs.missing,
          hint: cs.hint,
          notes_remaining: protocol.capture.field_questions.filter((q) => !(q.id in s.notes)).map((q) => q.id),
        };
      },
      triggerCapture: () => gate.trigger(),
      saveNote: (id, value) => send({ type: "NOTE", id, value }),
      reportUnsafe: () => send({ type: "END", reason: "unsafe" }),
      endSession: (reason) => {
        const phase = gate.stateRef.current.phase;
        if (phase === "notes") void submit();
        // Never end mid-burst or mid-upload; the burst finishes and the agent can ask again.
        else if (isPreCapture(phase)) send({ type: "END", reason });
      },
    }),
    [gate, protocol, send, submit],
  );
  const voice = useGrokVoice({
    mode: { kind: "guide", protocol, bountyTitle: bounty.title, bountySummary: bounty.summary },
    toolContext,
  });
  const { connect: voiceConnect, disconnect: voiceDisconnect, setCameraStatus, injectContext } = voice;

  useEffect(() => {
    if (voiceOn) void voiceConnect();
    else void voiceDisconnect("voice turned off");
  }, [voiceOn, voiceConnect, voiceDisconnect]);

  const csJson = JSON.stringify(gate.cameraStatus);
  useEffect(() => {
    if (isPreCapture(state.phase)) setCameraStatus(JSON.parse(csJson));
  }, [csJson, setCameraStatus, state.phase]);

  // ---------------- challenge → burst
  useEffect(() => {
    if (state.phase !== "challenge") return;
    let cancelled = false;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const t0 = Date.now();
    setCountdown(Math.ceil(CHALLENGE_LEAD_MS / 1000));
    const tick = setInterval(() => setCountdown(Math.max(0, Math.ceil((CHALLENGE_LEAD_MS - (Date.now() - t0)) / 1000))), 200);
    const timer = setTimeout(async () => {
      clearInterval(tick);
      setCountdown(null);
      if (cancelled) return;
      send({ type: "BURST_STARTED" });
      try {
        const frames = await runBurst(protocol.capture.frames, protocol.capture.frame_interval_ms, {
          capture: photoCapturer(photoOutput),
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          now: () => Date.now(),
          onFrame: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
        });
        framesRef.current = frames;
        uploadedRef.current = new Set();
        setBurstError(null);
        send({ type: "BURST_DONE" });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        injectContext(`[capture_status] ${JSON.stringify({ captured: true, frames: frames.length })}`, CAPTURE_DONE_RESPONSE_INSTRUCTIONS);
      } catch (e) {
        log.handled("burst", e);
        setBurstError("The photos didn't come through. Hold steady — the shutter unlocks again once the scene is re-checked.");
        send({ type: "BURST_FAILED", message: "burst failed" });
      }
    }, CHALLENGE_LEAD_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [injectContext, photoOutput, protocol.capture.frame_interval_ms, protocol.capture.frames, send, state.phase]);

  const onShutter = () => {
    const r = gate.trigger();
    if (!r.ok) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  };

  const ended = state.phase === "ended";
  const voiceDown = voiceOn && !ended && (voice.micDenied || voice.status === "error" || voice.status === "closed");
  const inNotes = state.phase === "notes" || state.phase === "uploading";
  const showChallenge = state.phase === "challenge" || state.phase === "capturing";

  return (
    <View style={{ flex: 1, backgroundColor: "black" }}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device="back"
        isActive={!ended && state.phase !== "done"}
        outputs={[photoOutput]}
        onPreviewStarted={() => setCameraReady(true)}
        onError={(e) => send({ type: "FRAME_ERROR", now: Date.now(), message: `camera: ${e.message}` })}
        resizeMode="cover"
      />

      {/* top: captions + controls */}
      <View style={[styles.topBar, { paddingTop: insets.top + S.sm }]}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: S.sm }}>
          <IconButton
            icon="x"
            label="End capture"
            onPress={() => {
              send({ type: "END", reason: "user_cancelled" });
              router.back();
            }}
          />
          <View style={{ alignItems: "center", gap: 4 }}>
            <MissionClock />
            <StatusPill
              tone={voice.status === "open" ? (voice.agentSpeaking ? "info" : "ok") : "neutral"}
              text={
                voice.status === "open"
                  ? voice.agentSpeaking
                    ? "Guide speaking"
                    : "Guide listening"
                  : !voiceOn
                    ? "Voice off"
                    : voiceDown
                      ? "Voice unavailable"
                      : "Voice connecting"
              }
              icon={voice.status === "open" ? (voice.agentSpeaking ? "volume-2" : "mic") : voiceOn ? "radio" : "mic-off"}
              style={{ backgroundColor: C.scrim, alignSelf: "center" }}
            />
          </View>
          <IconButton
            icon={voiceOn ? "mic" : "mic-off"}
            label={voiceOn ? "Turn voice guide off" : "Turn voice guide on"}
            role="switch"
            checked={voiceOn}
            color={voiceOn ? C.text : C.amber}
            onPress={() => setVoiceOn((v) => !v)}
          />
        </View>
        <View style={styles.captions}>
          {voiceDown ? (
            // Voice is optional: a calm notice + one action, never an error wall or alert.
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={voice.micDenied ? "Open Settings to allow the microphone" : "Reconnect the voice guide"}
              onPress={() => (voice.micDenied ? void Linking.openSettings().catch(() => undefined) : void voice.reconnect())}
              style={{ flexDirection: "row", gap: S.sm, alignItems: "flex-start" }}
            >
              <Icon name="mic-off" size={15} color={C.muted} style={{ marginTop: 3 }} />
              <Text style={{ color: C.text, fontFamily: F.body, fontSize: 15, lineHeight: 21, flex: 1 }}>
                {voice.notice ?? "Voice guide unavailable — tap to capture."}
                <Text style={{ color: C.accent }}>{voice.micDenied ? "  Open Settings" : "  Reconnect"}</Text>
              </Text>
            </Pressable>
          ) : (
            <CaptionList captions={voice.captions} max={3} />
          )}
        </View>
      </View>

      {showChallenge ? (
        <View style={styles.challenge} pointerEvents="none" accessibilityLiveRegion="assertive">
          <Label color={C.amber}>Challenge</Label>
          <Text style={styles.challengeText}>{session.challenge.instruction}</Text>
          <Text style={styles.challengeClock}>{state.phase === "capturing" ? "CAPTURING" : countdown !== null ? countdownLabel(countdown) : ""}</Text>
        </View>
      ) : null}

      {/* bottom sheet */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + S.md }]}>
        {queued ? (
          <View style={{ gap: S.md }} accessibilityLiveRegion="polite">
            <StatusPill tone="info" icon="wifi-off" text="Waiting for signal — your capture is saved" />
            <Body>We'll send it automatically when you're back online (keep the app installed; it retries when you open it). Track it in your wallet.</Body>
            <Button title="Back to bounties" icon="arrow-left" onPress={() => router.replace("/foryou")} />
          </View>
        ) : ended ? (
          <View style={{ gap: S.md }}>
            <StatusPill
              tone={state.endReason === "unsafe" ? "warn" : "neutral"}
              icon={state.endReason === "unsafe" ? "shield" : "square"}
              text={state.endReason === "unsafe" ? "Session ended for your safety" : "Session ended"}
            />
            <Body>There is no penalty for ending a session.</Body>
            <Button title="Back to bounties" icon="arrow-left" onPress={() => router.replace("/foryou")} />
          </View>
        ) : inNotes ? (
          <NotesForm
            questions={protocol.capture.field_questions}
            notes={state.notes}
            onAnswer={(id, v) => send({ type: "NOTE", id, value: v })}
            onSubmit={() => void submit()}
            uploading={state.phase === "uploading"}
            error={submitError}
          />
        ) : (
          <View style={{ gap: S.md }}>
            <ChecklistOverlay protocol={protocol} state={state} />
            {state.lastHint && state.phase !== "ready" && state.phase !== "cant_verify" ? (
              <View style={{ flexDirection: "row", gap: S.sm, alignItems: "flex-start" }}>
                <Icon name="corner-down-right" size={16} color={C.accent} style={{ marginTop: 3 }} />
                <Text style={{ color: C.text, fontFamily: F.bodyMedium, fontSize: 17, lineHeight: 23, flex: 1 }}>{state.lastHint}</Text>
              </View>
            ) : null}
            {gate.device.permission === "denied" ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Location is off. Open Settings." onPress={() => void Linking.openSettings().catch(() => undefined)}>
                <StatusPill tone="warn" icon="map-pin" text="Location is off — captures need it. Tap to open Settings." />
              </Pressable>
            ) : null}
            {burstError && state.phase !== "ready" ? <StatusPill tone="warn" icon="camera" text={burstError} /> : null}
            <Shutter locked={state.phase !== "ready"} reason={gate.lock} busy={showChallenge} onPress={onShutter} />
            <Label style={{ textAlign: "center" }}>
              {`${voiceDown || !voiceOn ? "Tap to capture" : "Say “capture” or tap"} · checks ${state.attempts}/${state.frameLimit}`}
            </Label>
          </View>
        )}
      </View>
    </View>
  );
}

/** T+MM:SS since the capture screen opened. Own component so the 1 s tick re-renders only this. */
function MissionClock() {
  const [t0] = useState(() => Date.now());
  const [now, setNow] = useState(t0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <Text style={styles.clock} accessibilityLabel={`Elapsed ${Math.floor((now - t0) / 1000)} seconds`}>
      {tPlus(now - t0)}
    </Text>
  );
}

/**
 * Unlocked: solid white bar, black type (maximum contrast in sunlight). Locked: black with an amber
 * outline, a lock icon and the single most important missing item.
 */
function Shutter({ locked, reason, busy, onPress }: { locked: boolean; reason: string | null; busy: boolean; onPress: () => void }) {
  const fg = busy ? C.text : locked ? C.amber : C.bg;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={locked ? `Shutter locked: ${reason ?? ""}` : "Capture"}
      accessibilityState={{ disabled: locked || busy }}
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.shutter,
        busy
          ? { backgroundColor: C.surface2, borderColor: C.hairline }
          : locked
            ? { backgroundColor: C.bg, borderColor: C.amber }
            : { backgroundColor: C.text, borderColor: C.text },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Icon name={busy ? "aperture" : locked ? "lock" : "aperture"} size={22} color={fg} />
      <Text style={[styles.shutterText, { color: fg }]} numberOfLines={2}>
        {busy ? "CAPTURING…" : locked ? (reason ?? "Locked") : "CAPTURE"}
      </Text>
    </Pressable>
  );
}

function NotesForm({
  questions,
  notes,
  onAnswer,
  onSubmit,
  uploading,
  error,
}: {
  questions: FieldQuestion[];
  notes: Record<string, string | number | boolean | null>;
  onAnswer: (id: string, v: string | number | boolean) => void;
  onSubmit: () => void;
  uploading: boolean;
  error: string | null;
}) {
  return (
    <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={{ gap: S.lg }} keyboardShouldPersistTaps="handled">
      <StatusPill tone="ok" text="Captured · answer by voice or tap" icon="check-circle" />
      {questions.map((q, i) => (
        <View key={q.id} style={{ gap: S.sm }}>
          <View style={{ flexDirection: "row", gap: S.sm, alignItems: "flex-start" }}>
            <Text style={styles.qIndex}>{indexLabel(i)}</Text>
            <Text style={{ color: C.text, fontFamily: F.bodySemi, fontSize: 17, lineHeight: 23, flex: 1 }}>{q.question}</Text>
          </View>
          <QuestionInput q={q} value={notes[q.id]} onAnswer={(v) => onAnswer(q.id, v)} />
        </View>
      ))}
      {error ? <StatusPill tone="bad" text={error} /> : null}
      <Button title={uploading ? "Uploading…" : "Submit for verification"} icon="upload" onPress={onSubmit} loading={uploading} />
    </ScrollView>
  );
}

function QuestionInput({ q, value, onAnswer }: { q: FieldQuestion; value: unknown; onAnswer: (v: string | number | boolean) => void }) {
  const [text, setText] = useState("");
  if (q.type === "enum" || q.type === "boolean") {
    const options: { label: string; v: string | boolean }[] =
      q.type === "enum" ? q.options.map((o) => ({ label: o, v: o })) : [{ label: "Yes", v: true }, { label: "No", v: false }];
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: S.sm }}>
        {options.map((o) => {
          const selected = value === o.v;
          return (
            <Pressable
              key={o.label}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onAnswer(o.v)}
              style={[styles.chip, selected ? { borderColor: C.text, backgroundColor: C.text } : { borderColor: C.hairline, backgroundColor: C.bg }]}
            >
              {selected ? <Icon name="check" size={16} color={C.bg} /> : null}
              <Text style={[styles.chipText, { color: selected ? C.bg : C.text }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }
  return (
    <TextInput
      value={text || (value === undefined || value === null ? "" : String(value))}
      onChangeText={setText}
      onEndEditing={() => {
        if (!text) return;
        if (q.type === "number") {
          const n = Number.parseFloat(text);
          if (Number.isFinite(n)) onAnswer(n);
        } else onAnswer(text);
      }}
      keyboardType={q.type === "number" ? "decimal-pad" : "default"}
      placeholder="Type an answer"
      placeholderTextColor={C.muted}
      accessibilityLabel={q.question}
      style={{ minHeight: TOUCH, borderBottomWidth: 1, borderColor: C.hairline, color: C.text, fontFamily: F.body, fontSize: T.body, paddingVertical: S.sm }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: C.bg, justifyContent: "center" },
  topBar: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: S.lg, gap: S.sm },
  clock: { color: C.text, fontFamily: F.numeralRegular, fontSize: 20, letterSpacing: TRACK.label, fontVariant: ["tabular-nums"], textShadowColor: "rgba(0,0,0,0.9)", textShadowRadius: 6 },
  captions: { backgroundColor: C.scrim, borderRadius: R.md, padding: S.md, minHeight: 56, borderWidth: StyleSheet.hairlineWidth, borderColor: C.hairline },
  challenge: {
    position: "absolute",
    top: "32%",
    left: S.lg,
    right: S.lg,
    backgroundColor: C.scrim,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.amber,
    padding: S.xl,
    alignItems: "center",
    gap: S.sm,
  },
  challengeText: { color: C.text, fontFamily: F.display, fontSize: 30, lineHeight: 34, letterSpacing: TRACK.heading, textAlign: "center", textTransform: "uppercase" },
  challengeClock: { color: C.amber, fontFamily: F.numeral, fontSize: T.numeralHero, fontVariant: ["tabular-nums"] },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.scrim,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.hairline,
    padding: S.lg,
  },
  shutter: { minHeight: 68, borderRadius: R.sm, borderWidth: 2, flexDirection: "row", gap: S.md, alignItems: "center", justifyContent: "center", paddingHorizontal: S.lg },
  shutterText: { fontFamily: F.display, fontSize: 20, letterSpacing: TRACK.heading, textTransform: "uppercase", flexShrink: 1, textAlign: "center" },
  chip: { minHeight: TOUCH, minWidth: 72, borderWidth: 1, borderRadius: R.sm, paddingHorizontal: S.md, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" },
  chipText: { fontFamily: F.display, fontSize: 16, letterSpacing: TRACK.label, textTransform: "uppercase" },
  qIndex: { color: C.muted, fontFamily: F.numeralRegular, fontSize: 17, fontVariant: ["tabular-nums"], minWidth: 22, marginTop: 1 },
});
