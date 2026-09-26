/**
 * Guided capture (PRD §7.4): full-bleed camera, bottom-sheet checklist, locked shutter showing the
 * single most important missing item, voice guide with captions always visible. The shutter button
 * and the voice `trigger_capture` tool go through the same `gate.trigger()`.
 */
import type { FieldQuestion } from "@groundtruth/shared";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Camera, useCameraPermission, usePhotoOutput, type CameraRef } from "react-native-vision-camera";
import { api, ApiError } from "../../src/api";
import { CHALLENGE_LEAD_MS, runBurst, sensorSnapshot, toMediaItems, type CapturedFrame } from "../../src/capture/burst";
import { ChecklistOverlay } from "../../src/capture/ChecklistOverlay";
import { deviceInfo, photoCapturer, uploadJpeg } from "../../src/capture/nativeCapture";
import { useCaptureGate } from "../../src/capture/useCaptureGate";
import { useCaptureStore, type ActiveCapture } from "../../src/state/captureStore";
import { Button, Muted, StatusPill } from "../../src/ui/components";
import { C, S, TOUCH } from "../../src/ui/theme";
import { CaptionList } from "../../src/voice/CaptionList";
import { CAPTURE_DONE_RESPONSE_INSTRUCTIONS } from "../../src/voice/instructions";
import type { ToolContext } from "../../src/voice/tools";
import { useGrokVoice } from "../../src/voice/useGrokVoice";

export default function CaptureScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const active = useCaptureStore((s) => (sessionId ? s.bySession[sessionId] : undefined));
  const perm = useCameraPermission();

  const { hasPermission, canRequestPermission, requestPermission } = perm;
  useEffect(() => {
    if (!hasPermission && canRequestPermission) void requestPermission();
  }, [hasPermission, canRequestPermission, requestPermission]);

  if (!active) {
    return (
      <View style={[styles.center, { padding: S.xl, gap: S.lg }]}>
        <StatusPill tone="bad" text="This capture session is no longer available" />
        <Button title="Back to bounties" onPress={() => router.replace("/foryou")} />
      </View>
    );
  }
  if (!perm.hasPermission) {
    return (
      <View style={[styles.center, { padding: S.xl, gap: S.lg }]}>
        <StatusPill tone="warn" text="Camera permission needed" />
        <Muted>GroundTruth only takes photos inside the app. Nothing is imported from your library.</Muted>
        <Button title="Allow camera" onPress={() => void perm.requestPermission()} />
        <Button title="Cancel" kind="secondary" onPress={() => router.back()} />
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
  const [countdown, setCountdown] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
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
      if (slots.length < frames.length) throw new Error("No upload slots left in this session — start a new capture.");
      await Promise.all(frames.map((f, i) => uploadJpeg(f.uri, slots[i]!)));
      const raw = gate.device.raw.current;
      if (raw.lat === null || raw.lng === null) throw new Error("No GPS fix");
      const res = await api.createSubmission({
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
          degraded: s.degraded,
          frame_checks: s.frameChecks,
          consecutive_green: s.greenStreak,
          last_hint: s.lastHint,
        },
      });
      markSubmitted(session.session_id, res.submission_id, frames.length);
      send({ type: "UPLOAD_DONE" });
      router.replace(`/result/${res.submission_id}`);
    } catch (e) {
      send({ type: "UPLOAD_FAILED", message: e instanceof Error ? e.message : String(e) });
      setSubmitError(e instanceof ApiError ? `${e.message} (${e.code})` : e instanceof Error ? e.message : String(e));
    } finally {
      submitting.current = false;
    }
  }, [active.usedUploads, gate.device.raw, gate.stateRef, markSubmitted, send, session]);

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
        else if (phase === "locating" || phase === "framing" || phase === "ready") send({ type: "END", reason });
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
    if (state.phase === "locating" || state.phase === "framing" || state.phase === "ready") setCameraStatus(JSON.parse(csJson));
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
        send({ type: "BURST_DONE" });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        injectContext(`[capture_status] ${JSON.stringify({ captured: true, frames: frames.length })}`, CAPTURE_DONE_RESPONSE_INSTRUCTIONS);
      } catch (e) {
        send({ type: "BURST_FAILED", message: e instanceof Error ? e.message : String(e) });
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
          <Pressable accessibilityRole="button" onPress={() => { send({ type: "END", reason: "user_cancelled" }); router.back(); }} style={styles.iconBtn}>
            <Text style={styles.iconBtnText}>✕</Text>
          </Pressable>
          <StatusPill
            tone={voice.status === "open" ? (voice.agentSpeaking ? "info" : "ok") : voice.status === "error" ? "bad" : "neutral"}
            text={voice.status === "open" ? (voice.agentSpeaking ? "Guide speaking" : "Guide listening") : `Voice ${voice.status}`}
            style={{ backgroundColor: C.overlay }}
          />
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: voiceOn }} onPress={() => setVoiceOn((v) => !v)} style={styles.iconBtn}>
            <Text style={styles.iconBtnText}>{voiceOn ? "🎙" : "🔇"}</Text>
          </Pressable>
        </View>
        <View style={styles.captions}>
          <CaptionList captions={voice.captions} max={3} />
          {voice.error ? <Text style={{ color: C.red, marginTop: 4 }}>Voice: {voice.error}</Text> : null}
        </View>
      </View>

      {showChallenge ? (
        <View style={styles.challenge} pointerEvents="none">
          <Text style={styles.challengeText}>{session.challenge.instruction}</Text>
          <Text style={{ color: C.text, fontSize: 18, marginTop: S.sm }}>
            {state.phase === "capturing" ? "Capturing…" : countdown !== null ? `Starting in ${countdown}` : ""}
          </Text>
        </View>
      ) : null}

      {/* bottom sheet */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + S.md }]}>
        {ended ? (
          <View style={{ gap: S.md }}>
            <StatusPill tone={state.endReason === "unsafe" ? "warn" : "neutral"} text={state.endReason === "unsafe" ? "Session ended for your safety" : "Session ended"} />
            <Muted>There is no penalty for ending a session.</Muted>
            <Button title="Back to bounties" onPress={() => router.replace("/foryou")} />
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
            {state.lastHint && state.phase !== "ready" && !state.degraded ? <Text style={{ color: C.text, fontSize: 15 }}>💡 {state.lastHint}</Text> : null}
            <Shutter locked={state.phase !== "ready"} reason={gate.lock} busy={showChallenge} onPress={onShutter} />
            <Muted style={{ textAlign: "center", fontSize: 12 }}>
              Say “capture” or tap · checks {state.frameChecks}/{state.frameLimit}
              {state.error && !state.degraded ? ` · ${state.error}` : ""}
            </Muted>
          </View>
        )}
      </View>
    </View>
  );
}

function Shutter({ locked, reason, busy, onPress }: { locked: boolean; reason: string | null; busy: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={locked ? `Shutter locked: ${reason ?? ""}` : "Capture"}
      accessibilityState={{ disabled: locked || busy }}
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.shutter,
        { backgroundColor: locked ? C.surface2 : C.green, borderColor: locked ? C.amber : C.green, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={{ color: locked ? C.amber : "#032010", fontSize: 18, fontWeight: "800" }} numberOfLines={2}>
        {busy ? "Capturing…" : locked ? `🔒 ${reason ?? "Locked"}` : "● Capture"}
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
    <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: S.md }}>
      <StatusPill tone="ok" text="Captured — answer by voice or tap" />
      {questions.map((q) => (
        <View key={q.id} style={{ gap: S.xs }}>
          <Text style={{ color: C.text, fontSize: 16, fontWeight: "600" }}>{q.question}</Text>
          <QuestionInput q={q} value={notes[q.id]} onAnswer={(v) => onAnswer(q.id, v)} />
        </View>
      ))}
      {error ? <StatusPill tone="bad" text={error} /> : null}
      <Button title={uploading ? "Uploading…" : "Submit for verification"} onPress={onSubmit} loading={uploading} />
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
              style={[styles.chip, { borderColor: selected ? C.green : C.border, backgroundColor: selected ? C.surface2 : "transparent" }]}
            >
              <Text style={{ color: selected ? C.green : C.text, fontWeight: "700" }}>
                {selected ? "✓ " : ""}
                {o.label}
              </Text>
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
      style={{ minHeight: TOUCH, borderWidth: 1, borderColor: C.border, borderRadius: 10, color: C.text, paddingHorizontal: S.md }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: C.bg, justifyContent: "center" },
  topBar: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: S.lg, gap: S.sm },
  iconBtn: { minWidth: TOUCH, minHeight: TOUCH, borderRadius: TOUCH / 2, backgroundColor: C.overlay, alignItems: "center", justifyContent: "center" },
  iconBtnText: { color: C.text, fontSize: 20 },
  captions: { backgroundColor: C.overlay, borderRadius: 12, padding: S.md, minHeight: 56 },
  challenge: { position: "absolute", top: "35%", left: S.lg, right: S.lg, backgroundColor: C.overlay, borderRadius: 16, padding: S.xl, alignItems: "center" },
  challengeText: { color: C.amber, fontSize: 24, fontWeight: "900", textAlign: "center" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: C.overlay, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: S.lg },
  shutter: { minHeight: 64, borderRadius: 32, borderWidth: 2, alignItems: "center", justifyContent: "center", paddingHorizontal: S.lg },
  chip: { minHeight: TOUCH, minWidth: 72, borderWidth: 1, borderRadius: 10, paddingHorizontal: S.md, alignItems: "center", justifyContent: "center" },
});
