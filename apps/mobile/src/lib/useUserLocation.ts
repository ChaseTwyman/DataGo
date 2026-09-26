import * as Location from "expo-location";
import { useEffect, useState } from "react";

export interface UserLocation {
  lat: number;
  lng: number;
  accuracyM: number | null;
}

/** Foreground location only (no background tracking, PRD §13). */
export function useUserLocation() {
  const [loc, setLoc] = useState<UserLocation | null>(null);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== "granted") {
        setDenied(true);
        return;
      }
      const last = await Location.getLastKnownPositionAsync();
      if (last && !cancelled) setLoc({ lat: last.coords.latitude, lng: last.coords.longitude, accuracyM: last.coords.accuracy ?? null });
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 25, timeInterval: 5000 }, (p) =>
        setLoc({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy ?? null }),
      );
      if (cancelled) sub.remove();
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);
  return { loc, denied };
}

/** One precise fix for starting a session. */
export async function preciseFix(): Promise<UserLocation> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") throw new Error("Location permission is required to start a capture.");
  const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
  return { lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy ?? null };
}
