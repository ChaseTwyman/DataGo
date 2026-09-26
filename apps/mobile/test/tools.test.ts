import { streetFloodDepth, type FieldQuestion } from "@groundtruth/shared";
import { describe, expect, it } from "vitest";
import { buildTools, coerceFieldNote, runTool, TOOL_NAMES, type CaptureStatus, type ToolContext } from "../src/voice/tools";

function ctx(over: Partial<CaptureStatus> = {}) {
  const calls: string[] = [];
  const notes: Record<string, unknown> = {};
  const status: CaptureStatus = { phase: "ready", ready: true, missing: [], hint: "Hold still.", notes_remaining: ["water_state", "debris_present"], ...over };
  const c: ToolContext = {
    protocol: streetFloodDepth,
    getStatus: () => ({ ...status, notes_remaining: status.notes_remaining.filter((id) => !(id in notes)) }),
    triggerCapture: () => {
      calls.push("trigger");
      return { ok: true, instruction: "Take one slow step to your left while I capture." };
    },
    saveNote: (id, v) => {
      notes[id] = v;
    },
    reportUnsafe: (d) => calls.push(`unsafe:${d}`),
    endSession: (r) => calls.push(`end:${r}`),
  };
  return { c, calls, notes };
}

describe("tool definitions", () => {
  it("defines the five tools with object parameters", () => {
    const tools = buildTools(streetFloodDepth);
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    for (const t of tools) {
      expect(t.type).toBe("function");
      expect(t.parameters.type).toBe("object");
    }
    const save = tools.find((t) => t.name === "save_field_note");
    expect(JSON.stringify(save?.parameters)).toContain('"enum":["water_state","debris_present"]');
  });
});

describe("coerceFieldNote", () => {
  const q = (id: string) => streetFloodDepth.capture.field_questions.find((f) => f.id === id) as FieldQuestion;
  it("maps spoken enum answers to options", () => {
    expect(coerceFieldNote(q("water_state"), "Still")).toEqual({ ok: true, value: "still" });
    expect(coerceFieldNote(q("water_state"), "pretty still I think")).toEqual({ ok: true, value: "still" });
    expect(coerceFieldNote(q("water_state"), "purple").ok).toBe(false);
  });
  it("maps yes/no to booleans", () => {
    expect(coerceFieldNote(q("debris_present"), "yeah, some leaves")).toEqual({ ok: true, value: true });
    expect(coerceFieldNote(q("debris_present"), "no")).toEqual({ ok: true, value: false });
    expect(coerceFieldNote(q("debris_present"), false)).toEqual({ ok: true, value: false });
    expect(coerceFieldNote(q("debris_present"), "maybe").ok).toBe(false);
  });
  it("parses numbers and text", () => {
    expect(coerceFieldNote({ id: "n", question: "?", type: "number" }, "about 12 cm")).toEqual({ ok: true, value: 12 });
    expect(coerceFieldNote({ id: "t", question: "?", type: "text" }, "  hi ")).toEqual({ ok: true, value: "hi" });
    expect(coerceFieldNote({ id: "t", question: "?", type: "text" }, null).ok).toBe(false);
  });
});

describe("runTool", () => {
  it("get_capture_status returns the gate snapshot", () => {
    const { c } = ctx({ ready: false, missing: ["waterline"], hint: "Tilt down" });
    expect(runTool("get_capture_status", {}, c).output).toMatchObject({ ready: false, missing: ["waterline"] });
  });

  it("trigger_capture refuses when not ready and does not start the burst", () => {
    const { c, calls } = ctx({ ready: false, missing: ["waterline"] });
    const r = runTool("trigger_capture", {}, c);
    expect(r.output).toMatchObject({ started: false, reason: "not_ready" });
    expect(calls).toEqual([]);
  });

  it("trigger_capture starts the challenge and returns the instruction to read", () => {
    const { c, calls } = ctx();
    const r = runTool("trigger_capture", {}, c);
    expect(calls).toEqual(["trigger"]);
    expect(r.output).toMatchObject({ started: true, instruction: expect.stringContaining("step to your left") });
    expect(r.respond).toBe(true);
  });

  it("save_field_note validates, stores, and reports what remains", () => {
    const { c, notes } = ctx();
    const r = runTool("save_field_note", { question_id: "water_state", value: "slow" }, c);
    expect(notes).toEqual({ water_state: "slow" });
    expect(r.output).toMatchObject({ saved: true, remaining: ["debris_present"] });
    const bad = runTool("save_field_note", { question_id: "water_state", value: "purple" }, c);
    expect(bad.output).toMatchObject({ saved: false, ask_again: "Is the water moving or still?" });
    expect(runTool("save_field_note", { question_id: "nope", value: "x" }, c).output).toMatchObject({ saved: false });
  });

  it("report_unsafe ends with no penalty after the agent thanks the user", () => {
    const { c, calls } = ctx();
    const r = runTool("report_unsafe", { description: "water is rising fast" }, c);
    expect(calls).toEqual(["unsafe:water is rising fast"]);
    expect(r).toMatchObject({ respond: true, endAfterPlayback: true, output: { penalty: false } });
  });

  it("end_session hangs up without another response", () => {
    const { c, calls } = ctx();
    const r = runTool("end_session", { reason: "done" }, c);
    expect(calls).toEqual(["end:done"]);
    expect(r).toMatchObject({ respond: false, endAfterPlayback: true });
  });

  it("unknown tools return an error output", () => {
    expect(runTool("fly", {}, ctx().c).output).toMatchObject({ error: expect.any(String) });
  });
});
