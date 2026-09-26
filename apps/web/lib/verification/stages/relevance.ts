/**
 * Layer 1b — subject relevance. One fast-vision call on the middle burst frame: is this a scene of
 * the protocol's subject at all? Added after a vitamin-water bottle was submitted to a street-flood
 * bounty and only a human reviewer stopped it (the reasoning model had timed out).
 *
 * Generic across protocols: the prompt is built from the protocol's name, why_it_matters and
 * required elements. Off-topic at ≥ OFF_TOPIC_CONFIDENCE → OFF_TOPIC (retryable protocol reject; the
 * contributor is told what was expected). If this call errors, the stage errors (→ review); it never
 * passes by default.
 */
import { isOffTopic, OFF_TOPIC_CONFIDENCE, type Subcheck } from "@groundtruth/shared";
import { toModelFrame } from "../../image/modelFrame";
import type { Stage, StageOutcome } from "../types";

/** The fast model only needs to recognise the subject; a small frame keeps the call ~2 s. */
export const RELEVANCE_FRAME_MAX_EDGE = 768;
const ELEMENT_VISIBLE_CONFIDENCE = 0.5;

export const relevance: Stage = {
  id: "relevance",
  async run(ctx): Promise<StageOutcome> {
    const { input, deps } = ctx;
    const { protocol } = input;
    const loaded = input.frames.filter((f) => f.bytes);
    if (loaded.length === 0) throw new Error("No frames available for the relevance check");
    const mid = loaded[Math.floor(loaded.length / 2)]!;
    const frame = await toModelFrame(mid.bytes!, RELEVANCE_FRAME_MAX_EDGE);
    const r = await deps.relevance({
      protocol,
      frameBase64: frame.toString("base64"),
      ...(input.mockVariant ? { variant: input.mockVariant } : {}),
    });

    const labels = protocol.capture.required_elements.map((e) => e.label.toLowerCase()).join(", ");
    const expected = `Expected: a ${protocol.name.toLowerCase()} scene (${labels})`;
    const saw = `Frame shows: ${r.off_topic.what_it_is || "—"}`;
    const elements: Subcheck[] = protocol.capture.required_elements.map((el) => {
      const seen = r.elements.find((e) => e.id === el.id);
      const visible = !!seen && seen.visible && seen.confidence >= ELEMENT_VISIBLE_CONFIDENCE;
      return {
        id: `element:${el.id}`,
        label: el.label,
        status: visible ? "pass" : "warn",
        detail: seen ? `${seen.visible ? "visible" : "not visible"} (${seen.confidence.toFixed(2)})` : "Not reported",
      };
    });
    const subjectDetail = `subject match ${r.subject_match.value ? "yes" : "no"} (${r.subject_match.confidence.toFixed(2)}); off-topic ${
      r.off_topic.value ? "yes" : "no"
    } (${r.off_topic.confidence.toFixed(2)})`;

    if (isOffTopic(r)) {
      return {
        status: "fail",
        score: 0,
        reasonCodes: ["OFF_TOPIC"],
        evidence: [`Off-topic capture (confidence ${r.off_topic.confidence.toFixed(2)} ≥ ${OFF_TOPIC_CONFIDENCE})`, expected, saw],
        subchecks: [{ id: "subject", label: "Scene of the protocol subject", status: "fail", detail: subjectDetail }, ...elements],
      };
    }
    const doubtful = r.off_topic.value || !r.subject_match.value;
    return {
      status: doubtful ? "warn" : "pass",
      score: doubtful ? 0.5 : r.subject_match.confidence,
      reasonCodes: [],
      evidence: [saw],
      subchecks: [{ id: "subject", label: "Scene of the protocol subject", status: doubtful ? "warn" : "pass", detail: subjectDetail }, ...elements],
    };
  },
};
