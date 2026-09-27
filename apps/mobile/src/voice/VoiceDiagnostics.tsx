/**
 * One-line voice diagnostics (long-press the voice pill on the capture screen). Distinguishes "xAI
 * sent no audio" (chunks 0) from "audio arrived but the output didn't play" (chunks > 0, clock stuck
 * or context not running) without a debugger attached to a Release build.
 */
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { C, F } from "../ui/theme";
import type { PlaybackStats } from "./audioEngine";
import { outputRouteLabel } from "./audioEngine";

export function VoiceDiagnostics({ status, error, stats }: { status: string; error: string | null; stats: () => PlaybackStats | null }) {
  const [line, setLine] = useState("…");
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const s = stats();
      const route = await outputRouteLabel();
      if (!alive) return;
      const audio = s
        ? `chunks ${s.chunks} (${s.seconds.toFixed(1)} s) · ctx ${s.contextState} · clock ${s.audioClock.toFixed(1)} · rebuilds ${s.rebuilds}${s.lastError ? ` · err ${s.lastError}` : ""}`
        : "no player";
      setLine(`voice ${status} · ${audio} · out ${route}${error ? ` · ${error.slice(0, 60)}` : ""}`);
    };
    void tick();
    const id = setInterval(() => void tick(), 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [error, stats, status]);
  return (
    <Text selectable style={{ color: C.amber, fontFamily: F.numeralRegular, fontSize: 12, lineHeight: 16, marginBottom: 6 }}>
      {line}
    </Text>
  );
}
