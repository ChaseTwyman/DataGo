import { streetFloodDepth } from "@groundtruth/shared";
import { describe, expect, it } from "vitest";
import { buildInstructions, INSTRUCTION_SECTIONS, safetyOpener } from "../src/voice/instructions";

describe("buildInstructions (BUILD_PROMPT §7.3)", () => {
  const text = buildInstructions(streetFloodDepth, { bountyTitle: "Midtown flood" });

  it("keeps the fixed section order with safety right after role", () => {
    const idx = INSTRUCTION_SECTIONS.map((h) => text.indexOf(h));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it("includes every safety rule as a bullet and the unsafe escalation", () => {
    for (const r of streetFloodDepth.safety.rules) expect(text).toContain(`- ${r}`);
    expect(text).toContain("call report_unsafe");
    expect(text).toContain("Never tell them to approach water");
  });

  it("names the protocol, why it matters, elements, and field questions", () => {
    expect(text).toContain("# Protocol: Street flood depth");
    expect(text).toContain(streetFloodDepth.why_it_matters);
    for (const e of streetFloodDepth.capture.required_elements) expect(text).toContain(e.label);
    expect(text).toContain("water_state");
    expect(text).toContain("still, slow, fast");
    expect(text).toContain("debris_present");
    expect(text).toContain("Midtown flood");
  });

  it("carries the coaching rules", () => {
    expect(text).toContain("[camera_status]");
    expect(text).toContain("under 12 words");
    expect(text).toContain('say "Hold still"');
    expect(text).toContain("call trigger_capture");
    expect(text).toContain("save_field_note");
    expect(text).toContain("end_session");
  });

  it("opener asks the protocol's check-in question verbatim", () => {
    expect(safetyOpener(streetFloodDepth)).toContain(streetFloodDepth.safety.check_in_question);
  });
});
