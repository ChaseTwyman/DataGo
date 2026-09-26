import { Text, View } from "react-native";
import { C, S } from "../ui/theme";
import type { Caption } from "./realtimeClient";

/** Captions for both sides, always visible during voice (noisy places, accessibility). */
export function CaptionList({ captions, max = 3 }: { captions: Caption[]; max?: number }) {
  const shown = captions.filter((c) => c.text.trim()).slice(-max);
  if (!shown.length) return <Text style={{ color: C.muted, fontStyle: "italic" }}>…</Text>;
  return (
    <View style={{ gap: S.xs }} accessibilityLiveRegion="polite">
      {shown.map((c) => (
        <Text key={c.id} style={{ color: c.role === "assistant" ? C.text : C.accent, fontSize: 16, lineHeight: 22, opacity: c.final ? 1 : 0.85 }}>
          <Text style={{ fontWeight: "800" }}>{c.role === "assistant" ? "Grok: " : "You: "}</Text>
          {c.text}
        </Text>
      ))}
    </View>
  );
}
