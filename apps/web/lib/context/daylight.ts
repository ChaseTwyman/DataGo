/** Sun position via suncalc: what lighting should a photo at (lat, lng, time) show? */
import { getPosition } from "suncalc";

export type Lighting = "day" | "dusk_dawn" | "night";

/** Sun altitude in degrees. */
export function sunAltitudeDeg(lat: number, lng: number, at: Date): number {
  return (getPosition(at, lat, lng).altitude * 180) / Math.PI;
}

/** day: sun > 6°; dusk/dawn: −6°..6° (civil twilight + golden hour); night: below −6°. */
export function expectedLighting(lat: number, lng: number, at: Date): Lighting {
  const alt = sunAltitudeDeg(lat, lng, at);
  if (alt > 6) return "day";
  if (alt >= -6) return "dusk_dawn";
  return "night";
}

/**
 * Compatible unless the model saw full day at night or full night in daytime. dusk_dawn is
 * compatible with either neighbour; "unclear" can't be judged (caller marks it skipped).
 */
export function lightingCompatible(expected: Lighting, seen: Lighting): boolean {
  if (expected === seen || expected === "dusk_dawn" || seen === "dusk_dawn") return true;
  return false;
}
