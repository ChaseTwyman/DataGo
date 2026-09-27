/**
 * Live capture gate: device checks + a frame-check loop (~1.2 s, one in flight, only when the
 * device checks pass): grab a frame (Android: PreviewView.takeSnapshot; iOS: silent photo, because
 * VisionCamera 5 throws "takeSnapshot() is not available on iOS!") → 640 px JPEG q 0.6 → base64 →
 * POST /api/capture/frame-check. Shutter button and voice "capture" both call `trigger()`.
 * The shutter unlocks only on the server's `gate_passed`; failures back off (gateMachine) and
 * never unlock.
 */
import type { LenientBountyDetail as BountyDetail, LenientCreateSessionResponse as CreateSessionResponse, Protocol } from "@groundtruth/shared";
import * as Haptics from "expo-haptics";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { Platform } from "react-native";
import type { CameraPhotoOutput, CameraRef } from "react-native-vision-camera";
import { grabFramePath, type FrameSource } from "./frameGrab";
import { api } from "../api";
import {
  cameraStatus,
  classifyFrameError,
  gateReducer,
  isPreCapture,
  initialGate,
  lockReason,
  notesRemaining,
  shouldRequestFrame,
  type GateEvent,
  type GateState,
} from "./gateMachine";
import { useDeviceChecks } from "./useDeviceChecks";

const FRAME_LONG_EDGE = 640;
const FRAME_QUALITY = 0.6;

function toFileUri(p: string): string {
  return p.startsWith("file://") || p.includes("://") ? p : `file://${p}`;
}

/** Grab a frame and encode a small JPEG for the fast vision model. */
export async function snapshotBase64(src: FrameSource): Promise<string> {
  const path = await grabFramePath(src, Platform.OS);
  // Render once to learn the upright size (photo width/height can be sensor-oriented), then resize.
  const full = await ImageManipulator.manipulate(toFileUri(path)).renderAsync();
  const ctx = ImageManipulator.manipulate(full);
  ctx.resize(full.width >= full.height ? { width: FRAME_LONG_EDGE } : { height: FRAME_LONG_EDGE });
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: FRAME_QUALITY, base64: true });
  if (!out.base64) throw new Error("snapshot encode failed");
  return out.base64;
}

export function useCaptureGate(opts: {
  protocol: Protocol;
  bounty: BountyDetail;
  session: CreateSessionResponse;
  cameraRef: React.RefObject<CameraRef | null>;
  photoOutput: CameraPhotoOutput;
  cameraReady: boolean;
}) {
  const { protocol, bounty, session, cameraRef, photoOutput, cameraReady } = opts;
  const reducer = useMemo(() => gateReducer(protocol), [protocol]);
  const [state, dispatch] = useReducer(reducer, session.frame_check_limit, initialGate);
  const stateRef = useRef<GateState>(state);
  stateRef.current = state;
  const preCapture = isPreCapture(state.phase);
  const device = useDeviceChecks(protocol, bounty, preCapture || state.phase === "challenge" || state.phase === "capturing");

  const send = useCallback((e: GateEvent) => {
    // keep the ref in sync synchronously so tool handlers see the new phase immediately
    stateRef.current = reducer(stateRef.current, e);
    dispatch(e);
  }, [reducer]);

  useEffect(() => {
    send({ type: "DEVICE", checks: device.checks });
  }, [device.checks, send]);

  // frame loop
  useEffect(() => {
    if (!cameraReady) return;
    let alive = true;
    const id = setInterval(() => {
      const now = Date.now();
      send({ type: "TICK", now });
      const s = stateRef.current;
      const cam = cameraRef.current;
      if (!shouldRequestFrame(s, now)) return;
      send({ type: "FRAME_REQUESTED", now });
      void (async () => {
        try {
          const image_base64 = await snapshotBase64({ camera: cam, photoOutput });
          const r = await api.frameCheck({ session_id: session.session_id, image_base64 });
          if (alive)
            send({
              type: "FRAME_RESULT",
              result: r.result,
              now: Date.now(),
              gatePassed: r.gate_passed === true,
              serverStreak: r.green_streak,
              checksRemaining: r.checks_remaining,
            });
        } catch (e) {
          if (alive) send({ type: "FRAME_ERROR", now: Date.now(), message: e instanceof Error ? e.message : String(e), kind: classifyFrameError(e) });
        }
      })();
    }, 300);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [cameraReady, cameraRef, photoOutput, send, session.session_id]);

  // haptic tick per element turning green; success buzz when the shutter unlocks
  const prevEls = useRef<Record<string, boolean>>({});
  const prevPhase = useRef(state.phase);
  useEffect(() => {
    for (const [id, ok] of Object.entries(state.elements)) {
      if (ok && !prevEls.current[id]) void Haptics.selectionAsync();
    }
    prevEls.current = state.elements;
    if (state.phase === "ready" && prevPhase.current !== "ready") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (state.screenSuspected) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    if (state.phase === "cant_verify" && prevPhase.current !== "cant_verify") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    prevPhase.current = state.phase;
  }, [state.elements, state.phase, state.screenSuspected]);

  /** Shared by the shutter button and the voice tool. */
  const trigger = useCallback((): { ok: true; instruction: string } | { ok: false; reason: string } => {
    const s = stateRef.current;
    if (s.phase !== "ready") return { ok: false, reason: lockReason(protocol, s) ?? `not ready (${s.phase})` };
    send({ type: "TRIGGER" });
    return { ok: true, instruction: session.challenge.instruction };
  }, [protocol, send, session.challenge.instruction]);

  return {
    state,
    stateRef,
    send,
    trigger,
    device,
    lock: lockReason(protocol, state),
    cameraStatus: cameraStatus(protocol, state),
    notesRemaining: notesRemaining(protocol, state),
  };
}
