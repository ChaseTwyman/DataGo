import * as Location from "expo-location";
import { useEffect, useState } from "react";
import { UserFacingError } from "../api/errors";
import { log } from "./log";

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
      try {
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
      } catch (e) {
        // Location Services off / unavailable: behave like "denied" (demo area + Settings link).
        log.handled("location", e);
        if (!cancelled) setDenied(true);
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);
  return { loc, denied };
}

/** Location permission is off: the UI offers "Open Settings" instead of an error. */
export class LocationPermissionError extends UserFacingError {
  constructor() {
    super("Captures are tied to where you are. Turn on location for GroundTruth in Settings.", "Location is off", false);
    this.name = "LocationPermissionError";
  }
}

/** One precise fix for starting a session. */
export async function preciseFix(): Promise<UserLocation> {
  let status: Location.PermissionStatus;
  try {
    status = (await Location.requestForegroundPermissionsAsync()).status;
  } catch {
    throw new LocationPermissionError();
  }
  if (status !== "granted") throw new LocationPermissionError();
  try {
    const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
    return { lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy ?? null };
  } catch {
    throw new UserFacingError("We couldn't get a GPS fix. Make sure Location Services are on, step outside if you can, and try again.", "No GPS fix");
  }
}
