/**
 * Deterministic fixtures for MOCK_GROK=1. Variants are selected by the `x-mock-variant` request
 * header (see MOCK_VARIANT_HEADER) so tests and the UI can exercise failure paths offline.
 */
import type { FrameCheckResult, MockVariant, Protocol, RelevanceResult, VerificationOutput } from "@groundtruth/shared";

export function mockFrameCheck(protocol: Protocol, variant: MockVariant = "default"): FrameCheckResult {
  const els = protocol.capture.required_elements;
  const base: FrameCheckResult = {
    elements: els.map((e) => ({ id: e.id, visible: true, confidence: 0.92 })),
    framing_ok: true,
    blur_ok: true,
    lighting_ok: true,
    suspected_screen_or_print: { value: false, confidence: 0.04 },
    hint: "Hold still.",
  };
  switch (variant) {
    case "screen_recapture":
      return {
        ...base,
        suspected_screen_or_print: { value: true, confidence: 0.93 },
        hint: "That looks like a screen. Point at the real scene.",
      };
    case "missing_element": {
      const last = els[els.length - 1];
      return {
        ...base,
        elements: els.map((e) => ({ id: e.id, visible: e.id !== last?.id, confidence: e.id === last?.id ? 0.2 : 0.9 })),
        hint: `Show the ${last?.label.toLowerCase() ?? "missing element"}.`.slice(0, 80),
      };
    }
    case "off_topic":
      return {
        ...base,
        elements: els.map((e) => ({ id: e.id, visible: false, confidence: 0.95 })),
        framing_ok: false,
        hint: "Point the camera at the scene described in the briefing.",
      };
    case "error":
      throw new Error("mock frame-check error");
    default:
      return base;
  }
}

/**
 * Relevance fixture. `off_topic` replays the vitamin-water incident. Note the `error` variant is the
 * reasoning model failing; the relevance mock stays healthy for it (tests inject relevance errors via
 * PipelineDeps.relevance).
 */
export function mockRelevance(protocol: Protocol, variant: MockVariant = "default"): RelevanceResult {
  const els = protocol.capture.required_elements;
  if (variant === "off_topic") {
    return {
      subject_match: { value: false, confidence: 0.96 },
      elements: els.map((e) => ({ id: e.id, visible: false, confidence: 0.95 })),
      off_topic: { value: true, confidence: 0.95, what_it_is: "A plastic bottle of vitamin water on a table indoors." },
    };
  }
  const last = els[els.length - 1];
  return {
    subject_match: { value: true, confidence: 0.93 },
    elements: els.map((e) => ({
      id: e.id,
      visible: !(variant === "missing_element" && e.id === last?.id),
      confidence: variant === "missing_element" && e.id === last?.id ? 0.3 : 0.9,
    })),
    off_topic: { value: false, confidence: 0.04, what_it_is: "Mock: shallow water on a street against a curb." },
  };
}

const noSuspicion = (evidence: string) => ({ suspected: false, confidence: 0.05, evidence });

/** Fills every required extraction field with a plausible value derived from its JSON-schema type. */
export function mockExtraction(protocol: Protocol): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const props = protocol.extraction_schema.properties;
  for (const [key, schema] of Object.entries(props)) {
    const s = schema as { type?: string | string[]; enum?: unknown[]; minimum?: number; maximum?: number };
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (s.enum && s.enum.length > 0) out[key] = s.enum[0];
    else if (types.includes("number") || types.includes("integer")) out[key] = s.maximum === 1 ? 0.8 : 18;
    else if (types.includes("boolean")) out[key] = false;
    else if (types.includes("string")) out[key] = "mock";
    else out[key] = null;
  }
  // Flood-specific realism: a curb-referenced reading.
  if ("depth_cm" in out) {
    Object.assign(out, {
      depth_cm: 12,
      depth_confidence: 0.75,
      reference_object_type: "curb",
      reference_object_assumed_height_cm: 15,
      surface_type: "road",
      water_state: "still",
      notes: "Mock: water reaches about 80% of a standard curb.",
    });
  }
  return out;
}

export function mockVerification(protocol: Protocol, variant: MockVariant = "default"): VerificationOutput {
  const base: VerificationOutput = {
    challenge: { performed: true, confidence: 0.9, evidence: "Viewpoint shifts consistently across the 3 frames." },
    real_3d_scene: { value: true, confidence: 0.92, evidence: "Foreground curb moves more than background buildings (parallax)." },
    elements: protocol.capture.required_elements.map((e) => ({
      id: e.id,
      present: true,
      confidence: 0.9,
      evidence: `${e.label} clearly visible.`,
    })),
    quality: { blur_ok: true, lighting_ok: true, framing_ok: true },
    authenticity: {
      screen_recapture: noSuspicion("No moiré, bezel, or pixel grid."),
      printed_photo: noSuspicion("No paper edges or print texture."),
      ai_generated: noSuspicion("Consistent reflections and textures."),
      edited_or_composited: noSuspicion("Lighting and shadows consistent."),
    },
    scene: { lighting: "day", visible_weather: "overcast, wet surfaces", internal_inconsistencies: [] },
    extraction: mockExtraction(protocol),
    protocol_score: 0.9,
    authenticity_score: 0.93,
    summary: "Mock: genuine capture meeting the protocol.",
  };
  switch (variant) {
    case "ai_generated":
      return {
        ...base,
        challenge: { performed: false, confidence: 0.85, evidence: "Frames are near-identical; no viewpoint shift." },
        real_3d_scene: { value: false, confidence: 0.7, evidence: "No parallax between frames." },
        authenticity: {
          ...base.authenticity,
          ai_generated: { suspected: true, confidence: 0.9, evidence: "Over-smooth water, malformed text on signage." },
        },
        authenticity_score: 0.15,
        summary: "Mock: likely AI-generated image.",
      };
    case "screen_recapture":
      return {
        ...base,
        real_3d_scene: { value: false, confidence: 0.9, evidence: "Flat plane; moiré visible." },
        authenticity: {
          ...base.authenticity,
          screen_recapture: { suspected: true, confidence: 0.93, evidence: "Moiré pattern and display bezel." },
        },
        authenticity_score: 0.1,
        summary: "Mock: photo of a screen.",
      };
    case "missing_element": {
      const last = protocol.capture.required_elements.at(-1);
      return {
        ...base,
        elements: base.elements.map((e) =>
          e.id === last?.id ? { ...e, present: false, confidence: 0.2, evidence: "Not visible in any frame." } : e,
        ),
        protocol_score: 0.45,
        summary: "Mock: required element missing.",
      };
    }
    case "error":
      throw new Error("mock verification error");
    default:
      return base;
  }
}
