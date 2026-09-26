/**
 * On-device gate checks (PRD §9.1): GPS fix with accuracy ≤ 25 m inside the bounty cells
 * (shared `insideBountyArea`), tilt ≤ protocol max_tilt_deg, steady for 500 ms.
 */
import { haversineM, insideBountyArea, type BountyDetail, type Protocol } from "@groundtruth/shared";
import { DeviceMotion } from "expo-sensors";
import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import type { DeviceChecks } from "./gateMachine";
import { NO_DEVICE } from "./gateMachine";
import { rollDeviationDeg, rotationMagnitude, SteadinessTracker, tiltOk } from "./deviceMath";

export interface DeviceRaw {
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  headingDeg: number | null;
  tiltDeg: number | null;
  rotationRate: number | null;
  steady: boolean;
}

const EMPTY_RAW: DeviceRaw = { lat: null, lng: null, accuracyM: null, headingDeg: null, tiltDeg: null, rotationRate: null, steady: false };

export function useDeviceChecks(protocol: Protocol, bounty: Pick<BountyDetail, "cells" | "area" | "center_lat" | "center_lng" | "radius_m">, active = true) {
  const [checks, setChecks] = useState<DeviceChecks>(NO_DEVICE);
  const [permission, setPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const raw = useRef<DeviceRaw>({ ...EMPTY_RAW });
  const loc = useRef<{ hasFix: boolean; accuracyM: number | null; insideArea: boolean; distanceM: number | null }>({
    hasFix: false,
    accuracyM: null,
    insideArea: false,
    distanceM: null,
  });
  const motion = useRef({ tiltOk: false, steady: false, tiltDeg: null as number | null });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let locSub: Location.LocationSubscription | null = null;
    const tracker = new SteadinessTracker(25, 500);
    let lastEmit = 0;

    const emit = (force = false) => {
      const now = Date.now();
      if (!force && now - lastEmit < 200) return; // ~5 Hz is plenty for UI + gate
      lastEmit = now;
      const next: DeviceChecks = { ...loc.current, ...motion.current };
      setChecks((prev) =>
        prev.hasFix === next.hasFix &&
        prev.accuracyM === next.accuracyM &&
        prev.insideArea === next.insideArea &&
        prev.tiltOk === next.tiltOk &&
        prev.steady === next.steady &&
        Math.round(prev.tiltDeg ?? -1) === Math.round(next.tiltDeg ?? -1) &&
        Math.round(prev.distanceM ?? -1) === Math.round(next.distanceM ?? -1)
          ? prev
          : next,
      );
    };

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      setPermission(status === "granted" ? "granted" : "denied");
      if (status !== "granted") return;
      locSub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
        (p) => {
          const { latitude, longitude, accuracy, heading } = p.coords;
          const inside = insideBountyArea(latitude, longitude, bounty.cells, bounty.area);
          const d = haversineM(latitude, longitude, bounty.center_lat, bounty.center_lng);
          loc.current = {
            hasFix: true,
            accuracyM: accuracy ?? null,
            insideArea: inside,
            distanceM: inside ? 0 : Math.max(0, d - bounty.radius_m),
          };
          raw.current = { ...raw.current, lat: latitude, lng: longitude, accuracyM: accuracy ?? null, headingDeg: heading ?? null };
          emit(true);
        },
      );
      if (cancelled) locSub.remove();
    })();

    DeviceMotion.setUpdateInterval(100);
    const motionSub = DeviceMotion.addListener((m) => {
      const g = m.accelerationIncludingGravity;
      const dev = g ? rollDeviationDeg(g.x, g.y, g.z, protocol.capture.orientation) : null;
      const rate = rotationMagnitude(m.rotationRate);
      const steady = tracker.update(rate, Date.now());
      motion.current = { tiltOk: tiltOk(dev, protocol.capture.max_tilt_deg), steady, tiltDeg: dev };
      raw.current = { ...raw.current, tiltDeg: dev, rotationRate: rate, steady };
      emit();
    });

    return () => {
      cancelled = true;
      locSub?.remove();
      motionSub.remove();
    };
  }, [active, bounty.area, bounty.cells, bounty.center_lat, bounty.center_lng, bounty.radius_m, protocol.capture.max_tilt_deg, protocol.capture.orientation]);

  return { checks, raw, permission };
}
