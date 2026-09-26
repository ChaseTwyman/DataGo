/**
 * Layer 2 — challenge-response (PRD §9.2): the random challenge was performed and the burst shows a
 * real 3D scene. Two signals: the reasoning model's judgment, and a model-independent one — a burst
 * whose frames are perceptually identical cannot contain the requested movement (a single image
 * submitted three times, e.g. a generated fake).
 */
import type { ReasonCode, Subcheck } from "@groundtruth/shared";
import { hamming } from "../../image/dhash";
import type { Stage, StageOutcome } from "../types";

export const CHALLENGE_FAIL_CONFIDENCE = 0.6;
export const FLAT_SCENE_CONFIDENCE = 0.8;

export const challenge: Stage = {
  id: "challenge",
  usesModel: true,
  async run(ctx): Promise<StageOutcome> {
    const { input } = ctx;
    const sub: Subcheck[] = [];
    const codes: ReasonCode[] = [];
    const evidence: string[] = [`Challenge: "${input.challenge.instruction}"`];

    if (input.protocol.capture.mode === "burst") {
      const hashes = await ctx.hashes();
      if (hashes.length >= 2) {
        let maxDist = 0;
        for (let i = 0; i < hashes.length; i++)
          for (let j = i + 1; j < hashes.length; j++) maxDist = Math.max(maxDist, hamming(hashes[i]!, hashes[j]!));
        if (maxDist === 0) {
          sub.push({ id: "burst_motion", label: "Movement across burst", status: "fail", detail: "All burst frames are identical" });
          codes.push("CHALLENGE_FAILED");
          evidence.push("Burst frames are perceptually identical: no movement between frames");
        } else {
          sub.push({ id: "burst_motion", label: "Movement across burst", status: "pass", detail: `max dHash distance ${maxDist}` });
        }
      }
    }

    const m = await ctx.model();
    const performed = m.challenge.performed;
    if (!performed && m.challenge.confidence >= CHALLENGE_FAIL_CONFIDENCE) {
      sub.push({ id: "performed", label: "Challenge performed", status: "fail", detail: m.challenge.evidence });
      codes.push("CHALLENGE_FAILED");
    } else {
      sub.push({ id: "performed", label: "Challenge performed", status: performed ? "pass" : "warn", detail: m.challenge.evidence });
    }
    evidence.push(m.challenge.evidence);

    const flat = !m.real_3d_scene.value;
    sub.push({
      id: "real_3d",
      label: "Real 3D scene (parallax)",
      status: flat ? (m.real_3d_scene.confidence >= FLAT_SCENE_CONFIDENCE ? "fail" : "warn") : "pass",
      detail: m.real_3d_scene.evidence,
    });
    evidence.push(m.real_3d_scene.evidence);

    const score = performed ? m.challenge.confidence : 0;
    const failed = codes.includes("CHALLENGE_FAILED");
    const warned = sub.some((s) => s.status === "warn" || s.status === "fail");
    return {
      status: failed ? "fail" : warned ? "warn" : "pass",
      score: failed ? 0 : score,
      reasonCodes: [...new Set(codes)],
      evidence,
      subchecks: sub,
    };
  },
};
