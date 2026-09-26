/**
 * React hook over RealtimeVoiceSession: fetches an ephemeral token, starts the mic and the socket
 * in parallel (mic audio buffers until the socket is open), plays replies, and exposes captions,
 * latency, and camera-status injection for the capture screen.
 */
import type { Protocol } from "@groundtruth/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { ENV } from "../lib/env";
import { activateVoiceAudioSession, deactivateVoiceAudioSession, ensureMicPermission, MicStream, QueuePlayer } from "./audioEngine";
import { buildInstructions, CAMERA_STATUS_RESPONSE_INSTRUCTIONS, safetyOpener, VOICE_TEST_INSTRUCTIONS } from "./instructions";
import {
  RealtimeVoiceSession,
  type Caption,
  type CameraStatusPayload,
  type SocketLike,
  type VoiceStatus,
} from "./realtimeClient";
import { buildTools, runTool, type ToolContext } from "./tools";

export type VoiceMode = { kind: "test" } | { kind: "guide"; protocol: Protocol; bountyTitle?: string; bountySummary?: string };

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
  const [error, setError] = useState<string | null>(null);
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

  const teardown = useCallback(async () => {
    const mic = micRef.current;
    const player = playerRef.current;
    micRef.current = null;
    playerRef.current = null;
    sessionRef.current = null;
    await mic?.stop();
    await player?.dispose();
    await deactivateVoiceAudioSession();
  }, []);

  const disconnect = useCallback(
    async (reason = "closed by user") => {
      sessionRef.current?.close(reason);
      await teardown();
    },
    [teardown],
  );

  const connect = useCallback(async () => {
    if (sessionRef.current) return;
    setError(null);
    setCaptions([]);
    setStatus("connecting");
    try {
      if (!(await ensureMicPermission())) throw new Error("Microphone permission denied");
      await activateVoiceAudioSession();
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
        log: (...a) => console.log(...a),
      });
      sessionRef.current = session;

      // Mic and token in parallel; mic chunks buffer inside the session until the socket opens.
      const mic = new MicStream();
      micRef.current = mic;
      const [token] = await Promise.all([
        api.voiceToken(),
        mic.start((chunk) => sessionRef.current?.appendAudio(chunk)),
      ]);
      if (sessionRef.current !== session) return; // disconnected meanwhile
      const url = token.url?.startsWith("wss://") ? token.url : undefined;
      session.connect(token.token, url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
      sessionRef.current?.close("connect failed");
      await teardown();
    }
  }, [teardown]);

  useEffect(() => () => void disconnect("unmounted"), [disconnect]);

  const setCameraStatus = useCallback((s: CameraStatusPayload) => sessionRef.current?.setCameraStatus(s), []);
  const injectContext = useCallback((text: string, instructions?: string) => sessionRef.current?.injectContext(text, instructions), []);

  const lastLatency = latencies.length ? (latencies[latencies.length - 1] ?? null) : null;
  return { status, captions, latencies, lastLatency, agentSpeaking, error, unknownEvents, connect, disconnect, setCameraStatus, injectContext };
}
