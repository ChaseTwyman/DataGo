/** MOCK_GROK fixtures for P1 features (Protocol Studio, Opportunity Radar). */
import type { DraftBounty, Protocol } from "@groundtruth/shared";

export function mockProtocolDraft(need: string): Protocol {
  return {
    slug: "leaf-disease-scout",
    version: 1,
    name: "Leaf disease scout",
    why_it_matters: `Early, located photos of symptomatic leaves let extension scientists map outbreaks before they spread. Requested: ${need.slice(0, 120)}`,
    safety: {
      level: "low",
      check_in_question: "Are you somewhere you are allowed to be, with permission to photograph these plants?",
      rules: ["Only photograph plants you have permission to access.", "Do not pick or move plants between fields.", "Stop at any time; there is no penalty."],
    },
    capture: {
      mode: "burst",
      frames: 3,
      frame_interval_ms: 600,
      orientation: "any",
      max_tilt_deg: 45,
      required_elements: [
        { id: "leaf_top", label: "Leaf top", description: "The upper surface of one affected leaf, filling most of the frame." },
        { id: "symptoms", label: "Symptoms", description: "Spots, lesions, or discoloration clearly visible on the leaf." },
        { id: "scale_coin", label: "Coin for scale", description: "A coin placed on or beside the leaf for scale." },
      ],
      framing_tips: ["Fill the frame with one leaf.", "Put the coin next to the worst spot.", "Avoid harsh shadows."],
      challenges: [
        { id: "flip_leaf", instruction: "Slowly turn the leaf over to show its underside while I capture.", expect: "Leaf surface changes from top to underside across the burst." },
        { id: "move_closer", instruction: "Move the phone slowly closer to the leaf while I capture.", expect: "Leaf and coin grow in frame across the burst." },
      ],
      field_questions: [
        { id: "crop", question: "Which crop is this?", type: "text" },
        { id: "plants_affected", question: "Roughly how many plants nearby look affected?", type: "enum", options: ["one", "few", "many"] },
      ],
    },
    extraction_schema: {
      type: "object",
      properties: {
        crop: { type: ["string", "null"], description: "Crop species if identifiable." },
        symptom_type: { type: "string", enum: ["spots", "blight", "mildew", "rust", "mosaic", "other"] },
        affected_area_pct: { type: ["number", "null"], description: "Estimated percent of the leaf surface affected." },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["symptom_type", "affected_area_pct", "confidence"],
    },
    acceptance: {
      min_protocol_score: 0.7,
      min_authenticity_score: 0.8,
      precipitation_plausibility: null,
      corroboration_radius_m: 500,
      corroboration_window_min: 1440,
      corroboration_field: "affected_area_pct",
      corroboration_tolerance: 20,
    },
    pricing: { urgency_tau_hours: 48 },
    example_image_prompt:
      "Photorealistic close-up of a tomato leaf with brown leaf-spot lesions, a US quarter coin beside the largest spot for scale, soft daylight. Instructional reference photo.",
  };
}

export function mockRadarDrafts(lat: number, lng: number, alertEvents: string[]): DraftBounty[] {
  return [
    {
      title: alertEvents[0] ? `${alertEvents[0]}: street flood depth` : "Heavy rain watch: street flood depth",
      summary: "Street-level depth readings during and after the rain calibrate the city flood model.",
      protocol_slug: "street-flood-depth",
      center_lat: lat,
      center_lng: lng,
      radius_m: 1500,
      rationale: alertEvents.length
        ? `Active NWS alerts: ${alertEvents.join(", ")}.`
        : "Mock: no active alerts; recent posts mention ponding on low streets.",
      sources: ["https://api.weather.gov/alerts/active"],
      alert_event: alertEvents[0] ?? null,
    },
  ];
}
