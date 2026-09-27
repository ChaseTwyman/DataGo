/**
 * React hook over RealtimeVoiceSession: fetches an ephemeral token, starts the mic and the socket
 * in parallel (mic audio buffers until the socket is open), plays replies, and exposes captions,
 * latency, and camera-status injection for the capture screen.
 */
import type { Protocol } from "@groundtruth/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { ENV } from "../lib/env";
import { log } from "../lib/log";
import { activateVoiceAudioSession, deactivateVoiceAudioSession, ensureMicPermission, MicStream, QueuePlayer } from "./audioEngine";
import { buildInstructions, CAMERA_STATUS_RESPONSE_INSTRUCTIONS, NARRATOR_INSTRUCTIONS, safetyOpener, VOICE_TEST_INSTRUCTIONS } from "./instructions";
import {
  RealtimeVoiceSession,
  type Caption,
  type CameraStatusPayload,
  type SocketLike,
  type VoiceStatus,
} from "./realtimeClient";
import { buildTools, runTool, type ToolContext } from "./tools";

/**
 * test: latency spike screen. guide: the capture field guide (mic, tools, opener).
 * narrator: speak-only verification companion — no mic, no tools, scripted lines via `speak()`.
 */
export type VoiceMode = { kind: "test" } | { kind: "guide"; protocol: Protocol; bountyTitle?: string; bountySummary?: string } | { kind: "narrator" };

export interface UseGrokVoiceOptions {
  mode: VoiceMode;
  /** Guide mode: tool context is read through a ref so it can change without reconnecting. */
  toolContext?: ToolContext;
  onEnd?: (reason: string) => void;
}

/** RN's WebSocket accepts a third `{ headers }` argument (not in the DOM typings). */
type RNWebSocketCtor = new (url: string, protocols?: string | string[], options?: { headers: Record<string, string> }) => SocketLike;

const rnSocketFactory = (url: string, token: string): SocketLike => {
  const WS = WebSocket as unknown as RNWebSocketCtor;
  return new WS(url, undefined, { headers: { Authorization: `Bearer ${token}` } });
};

export function useGrokVoice(opts: UseGrokVoiceOptions) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [latencies, setLatencies] = useState<number[]>([]);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  /** Raw technical detail — shown only on the dev-only voice test screen. */
  const [error, setError] = useState<string | null>(null);
  const [micDenied, setMicDenied] = useState(false);
  const [unknownEvents, setUnknownEvents] = useState<string[]>([]);

  const sessionRef = useRef<RealtimeVoiceSession | null>(null);
  const micRef = useRef<MicStream | null>(null);
  const playerRef = useRef<QueuePlayer | null>(null);
  const toolCtxRef = useRef<ToolContext | undefined>(opts.toolContext);
  toolCtxRef.current = opts.toolContext;
  const onEndRef = useRef(opts.onEnd);
  onEndRef.current = opts.onEnd;
  const modeRef = useRef(opts.mode);
  modeRef.current = opts.mode;
  const statusRef = useRef<VoiceStatus>(status);
  statusRef.current = status;
  /** Narrator lines asked for before the session existed. */
  const pendingScriptRef = useRef<string[]>([]);
  const endAfterSpeechRef = useRef(false);

  const teardown = useCallback(async () => {
    const mic = micRef.current;
    const player = playerRef.current;
    micRef.current = null;
    playerRef.current = null;
    sessionRef.current = null;
    // Best effort: a failing native teardown must never surface as an unhandled rejection.
    for (const step of [() => mic?.stop(), () => player?.dispose(), () => deactivateVoiceAudioSession()]) {
      try {
        await step();
      } catch (e) {
        log.handled("voice-teardown", e);
      }
    }
  }, []);

  /** Bumped by every connect/disconnect; an in-flight connect() bails out when it changes. */
  const genRef = useRef(0);
  const connectingRef = useRef(false);

  const disconnect = useCallback(
    async (reason = "closed by user") => {
      genRef.current++;
      connectingRef.current = false;
      pendingScriptRef.current = [];
      sessionRef.current?.close(reason);
      await teardown();
    },
    [teardown],
  );

  const connect = useCallback(async () => {
    // Synchronous re-entrancy guard: set before the first await so a double tap / double effect
    // cannot start two mics, players, and sockets.
    if (sessionRef.current || connectingRef.current) return;
    connectingRef.current = true;
    const gen = ++genRef.current;
    const stale = () => genRef.current !== gen;
    setError(null);
    setMicDenied(false);
    setCaptions([]);
    setStatus("connecting");
    try {
      const narrator = modeRef.current.kind === "narrator";
      // The narrator only talks (scripted lines): no mic, so no permission prompt and no turns.
      if (!narrator && !(await ensureMicPermission())) {
        setMicDenied(true);
        throw new Error("Microphone permission denied");
      }
      if (stale()) return;
      await activateVoiceAudioSession({ speakOnly: narrator });
      if (stale()) return;
      const player = new QueuePlayer();
      playerRef.current = player;
      const mode = modeRef.current;
      const session = new RealtimeVoiceSession({
        url: `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(ENV.voiceModel)}`,
        socketFactory: rnSocketFactory,
        sink: player,
        session:
          mode.kind === "guide"
            ? {
                instructions: buildInstructions(mode.protocol, { bountyTitle: mode.bountyTitle, bountySummary: mode.bountySummary }),
                tools: buildTools(mode.protocol),
                reasoningEffort: ENV.voiceReasoningEffort,
                transcribeInput: true,
              }
            : mode.kind === "narrator"
              ? { instructions: NARRATOR_INSTRUCTIONS, tools: [], reasoningEffort: "none" }
              : { instructions: VOICE_TEST_INSTRUCTIONS, tools: [], reasoningEffort: ENV.voiceReasoningEffort, transcribeInput: true },
        opener: mode.kind === "guide" ? safetyOpener(mode.protocol) : undefined,
        cameraStatusInstructions: CAMERA_STATUS_RESPONSE_INSTRUCTIONS,
        toolHandler: (name, args) => {
          const ctx = toolCtxRef.current;
          if (!ctx) return { output: { error: "no capture in progress" }, respond: true, endAfterPlayback: false };
          return runTool(name, args, ctx);
        },
        onStatus: (s, detail) => {
          setStatus(s);
          if (s === "error" && detail) setError(detail);
        },
        onCaptions: setCaptions,
        onLatency: (ms) => setLatencies((l) => [...l.slice(-19), ms]),
        onAgentSpeaking: setAgentSpeaking,
        onUnknownEvent: (type) => setUnknownEvents((u) => (u.includes(type) ? u : [...u, type])),
        onError: (m) => setError(m),
        onEnd: (reason) => {
          void teardown();
          onEndRef.current?.(reason);
        },
        log: (...a) => log.debug("voice", ...a),
      });
      sessionRef.current = session;
      // Lines asked for before the session existed are spoken once it is up.
      for (const line of pendingScriptRef.current.splice(0)) session.speak(line);
      if (endAfterSpeechRef.current) session.endAfterSpeech();

      // Mic and token in parallel; mic chunks buffer inside the session until the socket opens.
      let token: Awaited<ReturnType<typeof api.voiceToken>>;
      if (narrator) {
        token = await api.voiceToken();
      } else {
        const mic = new MicStream();
        micRef.current = mic;
        [token] = await Promise.all([api.voiceToken(), mic.start((chunk) => sessionRef.current?.appendAudio(chunk))]);
      }
      if (stale() || sessionRef.current !== session) return; // disconnected meanwhile
      const url = token.url?.startsWith("wss://") ? token.url : undefined;
      session.connect(token.token, url);
    } catch (e) {
      if (stale()) return;
      log.handled("voice-connect", e);
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
      sessionRef.current?.close("connect failed");
      await teardown();
    } finally {
      if (!stale()) connectingRef.current = false;
    }
  }, [teardown]);

  useEffect(() => () => void disconnect("unmounted"), [disconnect]);

  /**
   * Narrator: speak one scripted line verbatim (force_message). Connects on first use; while a
   * connect is in flight the line waits in a small queue. After a failed connect nothing retries
   * on its own (no token spam) — `reconnect()` is the explicit way back.
   */
  const speak = useCallback(
    (text: string) => {
      const s = sessionRef.current;
      if (s) return s.speak(text);
      if (statusRef.current === "error") throw new Error("voice unavailable");
      pendingScriptRef.current.push(text);
      if (pendingScriptRef.current.length > 3) pendingScriptRef.current.shift();
      void connect();
    },
    [connect],
  );
  /** Narrator: hang up after the queued lines have been spoken. */
  const endAfterSpeech = useCallback(() => {
    endAfterSpeechRef.current = true;
    sessionRef.current?.endAfterSpeech();
  }, []);

  /** Playback counters for the long-press voice diagnostics (null before the first connect). */
  const playbackStats = useCallback(() => playerRef.current?.stats() ?? null, []);
  const setCameraStatus = useCallback((s: CameraStatusPayload) => sessionRef.current?.setCameraStatus(s), []);
  const injectContext = useCallback((text: string, instructions?: string) => sessionRef.current?.injectContext(text, instructions), []);

  const lastLatency = latencies.length ? (latencies[latencies.length - 1] ?? null) : null;
  /** Drop whatever is left of a failed/closed session and connect again. */
  const reconnect = useCallback(async () => {
    await disconnect("reconnect");
    await connect();
  }, [connect, disconnect]);

  /**
   * Contributor-facing voice state: null while fine; otherwise one calm line. Capture never depends
   * on voice, so this is a notice, not an error.
   */
  const notice = micDenied
    ? "Microphone is off — voice guide unavailable. Tap to capture."
    : status === "error" || (status === "closed" && error !== null)
      ? "Voice guide unavailable — tap to capture."
      : null;

  return {
    status,
    captions,
    latencies,
    lastLatency,
    agentSpeaking,
    error,
    notice,
    micDenied,
    unknownEvents,
    connect,
    disconnect,
    reconnect,
    setCameraStatus,
    injectContext,
    speak,
    endAfterSpeech,
    playbackStats,
  };
}
