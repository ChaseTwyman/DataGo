/**
 * Grokbot message card (explain / final narration / price-why): headline, paragraphs, next steps
 * and a "Why?" expander listing the stored facts behind it in plain language. Design system look:
 * hairline card, uppercase label, 44 pt touch targets, icon + color + text.
 */
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Body, Card, Divider, Icon, Label, Muted } from "../ui/components";
import { C, F, S, T, TOUCH, TRACK } from "../ui/theme";
import type { GrokbotCardView } from "./messageView";

export function GrokbotCard({ view, label = "Grokbot", footer }: { view: GrokbotCardView; label?: string; footer?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ gap: S.md, borderColor: C.accent }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: S.sm }}>
        <Icon name="message-circle" size={16} color={C.accent} />
        <Label color={C.accent}>{label}</Label>
      </View>
      <View accessibilityLiveRegion="polite">
        <Text accessibilityRole="header" style={{ color: C.text, fontFamily: F.bodySemi, fontSize: T.title, lineHeight: Math.round(T.title * 1.3) }}>
          {view.headline}
        </Text>
      </View>
      {view.paragraphs.map((p, i) => (
        <Body key={`p${i}`}>{p}</Body>
      ))}
      {view.nextSteps.length ? (
        <View style={{ gap: S.sm }}>
          <Label>Next steps</Label>
          {view.nextSteps.map((s, i) => (
            <View key={`n${i}`} style={{ flexDirection: "row", gap: S.sm, alignItems: "flex-start" }}>
              <Icon name="arrow-right" size={16} color={C.accent} style={{ marginTop: 4 }} />
              <Body style={{ flex: 1 }}>{s}</Body>
            </View>
          ))}
        </View>
      ) : null}
      {view.why.length ? (
        <View>
          <Divider />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={open ? "Hide why" : "Why? Show what this is based on"}
            onPress={() => setOpen((o) => !o)}
            style={{ minHeight: TOUCH, flexDirection: "row", alignItems: "center", gap: S.sm }}
          >
            <Icon name={open ? "chevron-up" : "help-circle"} size={18} color={C.text} />
            <Text style={{ color: C.text, fontFamily: F.display, fontSize: 15, letterSpacing: TRACK.label, textTransform: "uppercase" }}>
              {open ? "Hide" : "Why?"}
            </Text>
          </Pressable>
          {open ? (
            <View style={{ gap: S.sm }}>
              <Muted>Based on:</Muted>
              {view.why.map((w, i) => (
                <View key={`w${i}`} style={{ flexDirection: "row", gap: S.sm, alignItems: "flex-start" }}>
                  <Icon name="check" size={14} color={C.muted} style={{ marginTop: 4 }} />
                  <Muted style={{ flex: 1 }}>{w}</Muted>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      {view.templated ? <Muted>Standard explanation (the AI assistant was unavailable).</Muted> : null}
      {footer}
    </Card>
  );
}

/** Narration lines as a caption timeline (always visible, voice or not). */
export function NarrationCaptions({ lines }: { lines: { seq: number; text: string }[] }) {
  if (!lines.length) return null;
  return (
    <View style={{ gap: S.sm }} accessibilityLiveRegion="polite">
      {lines.map((l, i) => {
        const latest = i === lines.length - 1;
        return (
          <View key={l.seq} style={{ flexDirection: "row", gap: S.sm, alignItems: "flex-start", opacity: latest ? 1 : 0.75 }}>
            <Icon name={latest ? "radio" : "check"} size={14} color={latest ? C.accent : C.muted} style={{ marginTop: 5 }} />
            <Text style={{ color: latest ? C.text : C.muted, fontFamily: latest ? F.bodyMedium : F.body, fontSize: 17, lineHeight: 24, flex: 1 }}>{l.text}</Text>
          </View>
        );
      })}
    </View>
  );
}
