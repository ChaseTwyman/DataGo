/**
 * Verification companion (Grokbot Phase 1) for the result screen: polls the narration, keeps the
 * caption timeline, speaks new lines (then the final headline) through a speak-only voice session,
 * and exposes mute. Captions never depend on voice; voice never depends on the endpoint existing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { log } from "../lib/log";
import { useGrokVoice } from "../voice/useGrokVoice";
import { NEUTRAL_INTEGRITY_CARD } from "./messageView";
import { pollNarration, type NarrationStopReason } from "./narrationPoller";
import { NarrationSpeaker } from "./narrationSpeaker";
import type { LenientGrokbotMessage, LenientNarrationLine } from "./schemas";

/** Captions kept on screen (the newest). */
const MAX_LINES = 12;

export type CompanionVoice = "off" | "connecting" | "speaking" | "ready" | "unavailable";

export function useVerificationCompanion(
  submissionId: string | undefined,
  opts: {
    voice: boolean;
    /** True once the screen knows this is an integrity reject: the final is then spoken neutrally. */
    integrityRef: { readonly current: boolean };
  },
) {
  const integrityRef = opts.integrityRef;
  const [lines, setLines] = useState<LenientNarrationLine[]>([]);
  const [final, setFinal] = useState<LenientGrokbotMessage | null>(null);
  const [stopped, setStopped] = useState<NarrationStopReason | null>(null);
  const [live, setLive] = useState(false);
  const [muted, setMutedState] = useState(!opts.voice);

  const voice = useGrokVoice({ mode: { kind: "narrator" } });
  const speakRef = useRef(voice.speak);
  speakRef.current = voice.speak;
  const endRef = useRef(voice.endAfterSpeech);
  endRef.current = voice.endAfterSpeech;
  const disconnectRef = useRef(voice.disconnect);
  disconnectRef.current = voice.disconnect;

  const speakerRef = useRef<NarrationSpeaker | null>(null);
  if (!speakerRef.current) {
    speakerRef.current = new NarrationSpeaker(
      { speak: (t) => speakRef.current(t) },
      { muted: !opts.voice, onSinkError: (e) => log.handled("companion-voice", e) },
    );
  }

  useEffect(() => {
    if (!submissionId) return;
    const speaker = speakerRef.current!;
    return pollNarration({
      fetch: (after) => api.narration(submissionId, after),
      onLines: (fresh, isLive) => {
        setLive(isLive);
        setLines((prev) => [...prev, ...fresh].slice(-MAX_LINES));
        for (const l of fresh) speaker.offerLine(l, isLive);
      },
      onFinal: (m, isLive) => {
        setLive(isLive);
        setFinal(m);
        // Integrity reject (as far as the screen knows): say the neutral line, not the server's.
        speaker.offerFinal(integrityRef.current ? { ...m, headline: NEUTRAL_INTEGRITY_CARD.headline } : m, isLive);
      },
      onStop: (reason) => {
        setStopped(reason);
        // Done (or nothing to narrate): hang up once whatever is queued has been spoken.
        if (reason !== "stopped") endRef.current();
      },
      onError: (e) => log.handled("companion-poll", e),
    });
  }, [submissionId, integrityRef]);

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    speakerRef.current?.setMuted(m);
    if (m) void disconnectRef.current("muted");
  }, []);

  const voiceState: CompanionVoice = muted
    ? "off"
    : voice.status === "error"
      ? "unavailable"
      : voice.status === "connecting"
        ? "connecting"
        : voice.status === "open"
          ? voice.agentSpeaking
            ? "speaking"
            : "ready"
          : "off";

  return {
    lines,
    final,
    /** The contributor watched it happen (vs. reopening a finished result). */
    live,
    /** Narration endpoint missing / refused: the screen offers Explain instead. */
    unsupported: stopped === "unsupported" || stopped === "forbidden",
    finished: stopped !== null,
    muted,
    setMuted,
    voiceState,
  };
}
