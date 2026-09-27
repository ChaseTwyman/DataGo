/**
 * Layer 5 — context plausibility (PRD §9.2): inside the bounty area and window, recent precipitation
 * (Open-Meteo), active NWS alerts at the point, and daylight (suncalc) vs the model's scene.lighting.
 * DEMO_MODE waives precipitation with DEMO_WAIVER, shown in the UI, never hidden.
 * An Open-Meteo failure throws → stage `error` → needs_review (never auto-accept). NWS is advisory
 * (US only, often zone-based), so its failure only skips that subcheck.
 */
import { insideBountyArea, isIndoorProtocol, type ReasonCode, type Subcheck } from "@groundtruth/shared";
import { expectedLighting, lightingCompatible } from "../../context/daylight";
import type { Stage, StageOutcome } from "../types";

const WEIGHT = { pass: 1, warn: 0.3, fail: 0 } as const;

export const context: Stage = {
  id: "context",
  async run(ctx): Promise<StageOutcome> {
    const { input, deps } = ctx;
    const sub: Subcheck[] = [];
    const codes: ReasonCode[] = [];
    const evidence: string[] = [];
    const at = new Date(input.captured_at);

    // area
    const inside = insideBountyArea(input.lat, input.lng, input.bounty.cells, input.bounty.area);
    sub.push({ id: "area", label: "Inside bounty area", status: inside ? "pass" : "fail", detail: `${input.lat.toFixed(5)}, ${input.lng.toFixed(5)}` });
    if (!inside) codes.push("OUTSIDE_AREA");

    // time window
    const t = at.getTime();
    const inWindow = t >= Date.parse(input.bounty.starts_at) && t <= Date.parse(input.bounty.ends_at);
    sub.push({ id: "window", label: "Inside bounty window", status: inWindow ? "pass" : "fail", detail: input.captured_at });
    if (!inWindow) codes.push("OUTSIDE_WINDOW");

    // precipitation
    const precip = input.protocol.acceptance.precipitation_plausibility;
    if (!precip) {
      sub.push({ id: "precipitation", label: "Recent precipitation", status: "skipped", detail: "Not required by protocol" });
    } else if (deps.demoMode) {
      sub.push({ id: "precipitation", label: "Recent precipitation", status: "waived", detail: "Waived (demo)" });
      codes.push("DEMO_WAIVER");
      evidence.push("Precipitation check waived (demo)");
    } else if (deps.offline) {
      sub.push({ id: "precipitation", label: "Recent precipitation", status: "skipped", detail: "Offline" });
    } else {
      const mm = await deps.precipitationMm(input.lat, input.lng, at, precip.lookback_hours);
      const ok = mm >= precip.min_total_mm;
      sub.push({
        id: "precipitation",
        label: "Recent precipitation",
        status: ok ? "pass" : "warn",
        detail: `${mm} mm in the last ${precip.lookback_hours} h (min ${precip.min_total_mm} mm)`,
      });
      if (!ok) codes.push("WEATHER_IMPLAUSIBLE");
      evidence.push(`Open-Meteo: ${mm} mm in ${precip.lookback_hours} h`);
    }

    // NWS alerts (advisory)
    if (deps.offline) {
      sub.push({ id: "alerts", label: "Weather alerts", status: "skipped", detail: "Offline" });
    } else {
      try {
        const alerts = await deps.alertsAt(input.lat, input.lng);
        if (alerts.length > 0) {
          const events = [...new Set(alerts.map((a) => a.event))].join(", ");
          sub.push({ id: "alerts", label: "Weather alerts", status: "pass", detail: `Active: ${events}` });
          evidence.push(`NWS active alerts: ${events}`);
        } else {
          sub.push({ id: "alerts", label: "Weather alerts", status: "skipped", detail: "No active alerts" });
        }
      } catch (err) {
        sub.push({ id: "alerts", label: "Weather alerts", status: "skipped", detail: `NWS unavailable: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    // daylight vs the model's view of the scene (outdoor protocols only: indoors, lamps decide the light)
    const expected = expectedLighting(input.lat, input.lng, at);
    const indoor = isIndoorProtocol(input.protocol);
    let seen: string | null = null;
    if (!indoor) {
      try {
        seen = (await ctx.model()).scene.lighting;
      } catch {
        seen = null; // model failure is reported by its own stages
      }
    }
    if (indoor) {
      sub.push({ id: "daylight", label: "Daylight matches", status: "skipped", detail: "Indoor protocol: daylight not applicable" });
    } else if (!seen || seen === "unclear") {
      sub.push({ id: "daylight", label: "Daylight matches", status: "skipped", detail: `Expected ${expected}; model: ${seen ?? "unavailable"}` });
    } else {
      const ok = lightingCompatible(expected, seen as "day" | "dusk_dawn" | "night");
      sub.push({ id: "daylight", label: "Daylight matches", status: ok ? "pass" : "warn", detail: `Expected ${expected}; image shows ${seen}` });
      if (!ok) codes.push("DAYLIGHT_MISMATCH");
    }

    const scored = sub.filter((s): s is Subcheck & { status: keyof typeof WEIGHT } => s.status in WEIGHT);
    const hardFail = !inside || !inWindow;
    const score = hardFail ? 0 : scored.reduce((a, s) => a + WEIGHT[s.status], 0) / Math.max(1, scored.length);
    const warned = sub.some((s) => s.status === "warn");
    return {
      status: hardFail ? "fail" : warned ? "warn" : "pass",
      score: Math.round(score * 1000) / 1000,
      reasonCodes: codes,
      evidence: evidence.length ? evidence : [indoor ? "Indoor protocol: inside the bounty area and window" : `Expected lighting: ${expected}`],
      subchecks: sub,
    };
  },
};
