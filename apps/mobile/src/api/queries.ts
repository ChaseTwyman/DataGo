import { DEMO } from "@groundtruth/shared";
import { useQuery } from "@tanstack/react-query";
import type { UserLocation } from "../lib/useUserLocation";
import { api } from "./index";

/** Nearby bounties; falls back to the demo center when location is unavailable. */
export function useNearby(loc: UserLocation | null, denied: boolean) {
  const center = loc ?? (denied ? { lat: DEMO.lat, lng: DEMO.lng, accuracyM: null } : null);
  // Round so small GPS jitter doesn't refetch.
  const key = center ? [Math.round(center.lat * 1000) / 1000, Math.round(center.lng * 1000) / 1000] : null;
  return useQuery({
    queryKey: ["nearby", key],
    enabled: !!center,
    queryFn: () => api.nearby(center!.lat, center!.lng, 50),
    refetchInterval: 30_000,
  });
}

export function useBounty(id: string | undefined) {
  return useQuery({ queryKey: ["bounty", id], enabled: !!id, queryFn: () => api.bounty(id!), refetchInterval: 30_000 });
}

export function useWallet() {
  return useQuery({ queryKey: ["wallet"], queryFn: api.wallet, refetchInterval: 15_000 });
}

/** GET /api/me: who is signed in, roles, suspension, trust + balance. Drives the root gate. */
export function useMe(enabled = true) {
  return useQuery({ queryKey: ["me"], enabled, queryFn: api.me, refetchInterval: 60_000 });
}
