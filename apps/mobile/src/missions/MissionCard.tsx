/**
 * Revisit missions on the phone: "Revisit due in 12 min · same spot" with a live countdown. Tapping
 * opens the bounty briefing — the capture flow (safety check, server gate, challenge) is unchanged.
 */
import { DEMO, formatCents, missionCountdownLabel, type LenientMissionSummary } from "@groundtruth/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { api } from "../api";
import { ApiError } from "../api/http";
import type { UserLocation } from "../lib/useUserLocation";
import { Icon, Label } from "../ui/components";
import { C, F, R, S, T } from "../ui/theme";

/** Missions near me; a server without the endpoint (404) just means none. */
export function useMissions(loc: UserLocation | null, denied: boolean) {
  const center = loc ?? (denied ? { lat: DEMO.lat, lng: DEMO.lng, accuracyM: null } : null);
  const key = center ? [Math.round(center.lat * 1000) / 1000, Math.round(center.lng * 1000) / 1000] : null;
  return useQuery({
    queryKey: ["missions", key],
    enabled: !!center,
    queryFn: async () => {
      try {
        return (await api.missions(center!.lat, center!.lng, 50)).missions;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 501)) return [];
        throw e;
      }
    },
    refetchInterval: 60_000,
  });
}

/** Re-renders every `ms` so countdowns stay live. */
export function useNow(ms = 15_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function missionLabel(m: LenientMissionSummary, now: Date): string {
  return missionCountdownLabel(m, now, { yours: m.yours, reserved: m.reserved });
}

export function MissionCard({ m, now }: { m: LenientMissionSummary; now: Date }) {
  const label = missionLabel(m, now);
  const live = now.getTime() >= Date.parse(m.opens_at) && !m.reserved;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${m.bounty_title}. Open briefing.`}
      onPress={() => router.push(`/bounty/${m.bounty_id}`)}
      style={({ pressed }) => ({
        borderWidth: 1,
        borderColor: live ? C.accent : C.hairline,
        borderRadius: R.md,
        padding: S.md,
        gap: S.xs,
        backgroundColor: pressed ? C.surface2 : C.surface,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: S.sm }}>
        <Icon name="repeat" size={16} color={live ? C.accent : C.muted} />
        <Text style={{ color: C.text, fontFamily: F.bodySemi, fontSize: T.body, flex: 1 }} numberOfLines={2}>
          {label}
        </Text>
        {m.price_cents !== null ? <Text style={{ color: C.accent, fontFamily: F.numeralRegular, fontSize: 18 }}>{formatCents(m.price_cents)}</Text> : null}
      </View>
      <Label>{`${m.bounty_title} · +${m.interval_min} min reading`}</Label>
    </Pressable>
  );
}
