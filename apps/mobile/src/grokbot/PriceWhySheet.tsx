/**
 * "Why this price?" sheet: GET /api/grokbot/bounties/:id/price-why (grounded only in price_reasons
 * + public factors). If that fails or isn't deployed yet, the bounty's own `price_reasons` are shown
 * instead — the contributor never sees an error here.
 */
import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { Modal, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../api";
import { log } from "../lib/log";
import { Body, Heading, Icon, IconButton, Label, LoadingState, Muted } from "../ui/components";
import { C, S, T } from "../ui/theme";
import { GrokbotCard } from "./GrokbotCard";
import { priceWhyView, type PriceWhyView } from "./messageView";

/**
 * Where the contributor is, only if location is ALREADY allowed (never prompts, never watches):
 * the last known fix rounded to ~100 m. Null otherwise — the server then explains without it.
 */
async function lastKnownRounded(): Promise<{ lat: number; lng: number } | null> {
  try {
    if ((await Location.getForegroundPermissionsAsync()).status !== "granted") return null;
    const p = await Location.getLastKnownPositionAsync();
    return p ? { lat: Math.round(p.coords.latitude * 1000) / 1000, lng: Math.round(p.coords.longitude * 1000) / 1000 } : null;
  } catch {
    return null;
  }
}

export function PriceWhySheet({
  visible,
  onClose,
  bountyId,
  localReasons,
}: {
  visible: boolean;
  onClose: () => void;
  bountyId: string;
  localReasons: readonly string[] | undefined;
}) {
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<PriceWhyView | null>(null);
  const reasonsKey = (localReasons ?? []).join("|");

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setView(null);
    const reasons = reasonsKey ? reasonsKey.split("|") : [];
    void (async () => {
      try {
        const message = await api.priceWhy(bountyId, await lastKnownRounded());
        if (!cancelled) setView(priceWhyView({ ok: true, message }, reasons));
      } catch (error) {
        log.handled("price-why", error);
        if (!cancelled) setView(priceWhyView({ ok: false, error }, reasons));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, bountyId, reasonsKey]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: S.sm, padding: S.lg, paddingBottom: S.sm }}>
          <Heading size={T.title} style={{ flex: 1 }}>
            Why this price?
          </Heading>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={{ padding: S.lg, gap: S.lg, paddingBottom: insets.bottom + S.xxl }}>
          {!view ? <LoadingState label="Asking Grokbot…" /> : null}
          {view?.kind === "message" ? <GrokbotCard view={view.card} label="Grokbot · pricing" /> : null}
          {view?.kind === "local" ? (
            <View style={{ gap: S.md }}>
              <Label>What sets this price</Label>
              {view.reasons.map((r) => (
                <View key={r} style={{ flexDirection: "row", gap: S.sm, alignItems: "flex-start" }}>
                  <Icon name="trending-up" size={16} color={C.accent} style={{ marginTop: 4 }} />
                  <Body style={{ flex: 1 }}>{r}</Body>
                </View>
              ))}
            </View>
          ) : null}
          {view?.kind === "none" ? <Body>{view.text}</Body> : null}
          {view ? (
            <Muted>
              GroundTruth sets every price; researchers and sponsors don&apos;t. Starting a capture locks the price for 15 minutes. Payout = locked price ×
              quality (0.8–1.2).
            </Muted>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}
