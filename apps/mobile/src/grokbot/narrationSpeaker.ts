/**
 * Verification companion, voice side: decides which narration lines get spoken. Pure, unit-tested.
 *
 * - Speaks only scripted text (a narration line, then the final headline) — the voice session reads
 *   it verbatim via force_message; nothing is ever sent to the model to generate from.
 * - Each line is spoken at most once. Lines that arrive while muted are marked handled, so
 *   unmuting doesn't replay a backlog.
 * - Not `live` (the result was already finished when the screen opened) → captions only.
 * - A failing voice sink never throws out of here: captions don't depend on voice.
 */
import type { LenientGrokbotMessage, LenientNarrationLine } from "./schemas";

export interface ScriptSink {
  /** Queue one line to be spoken verbatim. May throw (voice unavailable). */
  speak(text: string): void;
}

/** Longest line we'll ever hand to TTS (the contract caps lines at 200 and headlines at 160). */
export const MAX_SPOKEN_CHARS = 200;

export function speakable(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > MAX_SPOKEN_CHARS ? `${t.slice(0, MAX_SPOKEN_CHARS - 1).trimEnd()}…` : t;
}

export class NarrationSpeaker {
  private readonly handled = new Set<string>();
  private muted: boolean;

  constructor(
    private readonly sink: ScriptSink,
    opts: { muted?: boolean; onSinkError?: (e: unknown) => void } = {},
  ) {
    this.muted = opts.muted ?? false;
    this.onSinkError = opts.onSinkError;
  }

  private readonly onSinkError?: (e: unknown) => void;

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(m: boolean): void {
    this.muted = m;
  }

  /** Returns true when the line was handed to the voice sink. */
  offerLine(line: LenientNarrationLine, live: boolean): boolean {
    return this.offer(`line:${line.seq}`, line.text, live);
  }

  offerFinal(message: LenientGrokbotMessage, live: boolean): boolean {
    return this.offer("final", message.headline, live);
  }

  private offer(key: string, text: string, live: boolean): boolean {
    if (this.handled.has(key)) return false;
    this.handled.add(key);
    const t = speakable(text);
    if (!live || this.muted || !t) return false;
    try {
      this.sink.speak(t);
      return true;
    } catch (e) {
      this.onSinkError?.(e);
      return false;
    }
  }
}
