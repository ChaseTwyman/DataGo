import { Text, View } from "react-native";
import { C, F, S, TRACK } from "../ui/theme";
import type { Caption } from "./realtimeClient";

/** Captions for both sides, always visible during voice (noisy places, accessibility). */
/** `lines`: clamp each caption (landscape top bar); the newest text is kept by showing only `max` captions. */
export function CaptionList({ captions, max = 3, lines }: { captions: Caption[]; max?: number; lines?: number }) {
  const shown = captions.filter((c) => c.text.trim()).slice(-max);
  if (!shown.length) return <Text style={{ color: C.muted, fontFamily: F.display, fontSize: 13, letterSpacing: TRACK.label }}>STANDING BY…</Text>;
  return (
    <View style={{ gap: S.sm }} accessibilityLiveRegion="polite">
      {shown.map((c) => {
        const guide = c.role === "assistant";
        return (
          <View key={c.id} style={{ flexDirection: "row", gap: S.sm, alignItems: "flex-start", opacity: c.final ? 1 : 0.85 }}>
            <Text style={{ color: guide ? C.accent : C.muted, fontFamily: F.display, fontSize: 13, letterSpacing: TRACK.label, width: 46, marginTop: 3 }}>
              {guide ? "GUIDE" : "YOU"}
            </Text>
            <Text style={{ color: guide ? C.text : C.muted, fontFamily: guide ? F.bodyMedium : F.body, fontSize: 17, lineHeight: 24, flex: 1 }} numberOfLines={lines} ellipsizeMode="head">
              {c.text}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
