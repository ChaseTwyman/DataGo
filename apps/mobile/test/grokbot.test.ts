import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/http";
import { toUserMessage } from "../src/api/errors";
import { citationText, explainErrorText, grokbotCardView, priceWhyView } from "../src/grokbot/messageView";
import { pollNarration, type NarrationStopReason } from "../src/grokbot/narrationPoller";
import { NarrationSpeaker, speakable } from "../src/grokbot/narrationSpeaker";
import { areasFromText, saveProfileAndRefresh, splitList } from "../src/grokbot/profile";
import {
  LenientGrokbotMessageSchema,
  LenientNarrationResponseSchema,
  type LenientGrokbotMessage,
  type LenientNarrationLine,
  type LenientNarrationResponse,
} from "../src/grokbot/schemas";

// ------------------------------------------------------------------ fakes

class FakeTimers {
  t = 0;
  items: { at: number; fn: () => void; id: number }[] = [];
  private seq = 0;
  waits: number[] = [];
  setTimeout = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.waits.push(ms);
    this.items.push({ at: this.t + ms, fn, id });
    return id;
  };
  clearTimeout = (h: unknown) => {
    this.items = this.items.filter((i) => i.id !== h);
  };
  async advance(ms: number) {
    this.t += ms;
    const due = this.items.filter((i) => i.at <= this.t);
    this.items = this.items.filter((i) => i.at > this.t);
    due.forEach((i) => i.fn());
    await flush();
  }
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

const line = (seq: number, text = `line ${seq}`): LenientNarrationLine => ({ seq, stage: "relevance", text, at: "2026-09-26T00:00:00Z" });
const msg = (over: Partial<LenientGrokbotMessage> = {}): LenientGrokbotMessage => ({
  headline: "Accepted — nice work.",
  paragraphs: ["Your reading is on the map."],
  next_steps: ["Try the next bounty nearby."],
  citations: [],
  source: "grok",
  generated_at: "2026-09-26T00:00:00Z",
  ...over,
});
const resp = (lines: LenientNarrationLine[], done = false, final: LenientGrokbotMessage | null = null): LenientNarrationResponse => ({ lines, done, final });

function startPoller(responses: (LenientNarrationResponse | Error)[]) {
  const timers = new FakeTimers();
  const afters: (number | undefined)[] = [];
  const got: { seq: number; live: boolean }[] = [];
  const finals: { headline: string; live: boolean }[] = [];
  const stops: NarrationStopReason[] = [];
  let i = 0;
  const stop = pollNarration({
    fetch: async (after) => {
      afters.push(after);
      const r = responses[Math.min(i++, responses.length - 1)]!;
      if (r instanceof Error) throw r;
      return r;
    },
    onLines: (ls, live) => ls.forEach((l) => got.push({ seq: l.seq, live })),
    onFinal: (m, live) => finals.push({ headline: m.headline, live }),
    onStop: (r) => stops.push(r),
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    now: () => timers.t,
  });
  return { timers, afters, got, finals, stops, stop };
}

// ------------------------------------------------------------------ narration polling

describe("pollNarration", () => {
  it("delivers each line once in seq order, dedupes resent lines, and advances ?after", async () => {
    const p = startPoller([resp([line(1), line(0)]), resp([line(1), line(2)]), resp([line(2), line(3)], true, msg())]);
    await flush();
    expect(p.got.map((g) => g.seq)).toEqual([0, 1]);
    await p.timers.advance(1500);
    await p.timers.advance(1500);
    expect(p.got.map((g) => g.seq)).toEqual([0, 1, 2, 3]);
    expect(p.afters).toEqual([undefined, 1, 2]);
    expect(p.finals).toEqual([{ headline: "Accepted — nice work.", live: true }]);
    expect(p.stops).toEqual(["done"]);
    expect(p.timers.items).toHaveLength(0);
  });

  it("polls every ~1.5 s while not done", async () => {
    const p = startPoller([resp([])]);
    await flush();
    await p.timers.advance(1500);
    await p.timers.advance(1500);
    expect(p.afters).toHaveLength(3);
    expect(p.timers.waits.slice(0, 3)).toEqual([1500, 1500, 1500]);
    p.stop();
    expect(p.stops).toEqual(["stopped"]);
  });

  it("backs off on errors (doubling, capped) and recovers", async () => {
    const boom = new ApiError(503, "SERVER", "down");
    const p = startPoller([boom, boom, boom, boom, boom, resp([line(0)], true)]);
    await flush();
    for (const w of [3000, 6000, 12000, 12000, 12000]) await p.timers.advance(w);
    expect(p.timers.waits.slice(0, 5)).toEqual([3000, 6000, 12000, 12000, 12000]);
    expect(p.got.map((g) => g.seq)).toEqual([0]);
    expect(p.stops).toEqual(["done"]);
  });

  it("stops quietly when the endpoint isn't deployed (404/501) or not allowed (403)", async () => {
    for (const [status, reason] of [
      [404, "unsupported"],
      [501, "unsupported"],
      [403, "forbidden"],
    ] as const) {
      const p = startPoller([new ApiError(status, `HTTP_${status}`, "x")]);
      await flush();
      expect(p.stops).toEqual([reason]);
      expect(p.timers.items).toHaveLength(0);
    }
  });

  it("an already-finished submission is not live (captions only, nothing spoken)", async () => {
    const p = startPoller([resp([line(0)], true, msg())]);
    await flush();
    expect(p.got).toEqual([{ seq: 0, live: false }]);
    expect(p.finals[0]?.live).toBe(false);
  });

  it("gives up after the max duration", async () => {
    const timers = new FakeTimers();
    const stops: string[] = [];
    pollNarration({
      fetch: async () => resp([]),
      onLines: () => undefined,
      onFinal: () => undefined,
      onStop: (r) => stops.push(r),
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      now: () => timers.t,
      maxDurationMs: 4000,
    });
    await flush();
    for (let i = 0; i < 4; i++) await timers.advance(1500);
    expect(stops).toEqual(["timeout"]);
  });

  it("parses leniently: bad lines are dropped, unknown fields ignored, missing done → false", () => {
    const r = LenientNarrationResponseSchema.parse({
      lines: [{ seq: 0, stage: "relevance", text: "Checking.", at: "x", extra: 1 }, { seq: "bad" }],
      final: { headline: "Hi", paragraphs: ["a", 3], next_steps: [], citations: [{ kind: "new_kind", ref: "r" }, { nope: 1 }], source: "future" },
    });
    expect(r.lines).toHaveLength(1);
    expect(r.done).toBe(false);
    expect(r.final?.paragraphs).toEqual(["a"]);
    expect(r.final?.citations).toEqual([{ kind: "new_kind", ref: "r", detail: undefined }]);
  });
});

// ------------------------------------------------------------------ speaking

describe("NarrationSpeaker", () => {
  it("speaks each line exactly once, then the final headline once", () => {
    const said: string[] = [];
    const sp = new NarrationSpeaker({ speak: (t) => said.push(t) });
    sp.offerLine(line(0, "Checking the photo."), true);
    sp.offerLine(line(0, "Checking the photo."), true);
    sp.offerLine(line(1, "Reading the ruler."), true);
    sp.offerFinal(msg(), true);
    sp.offerFinal(msg(), true);
    expect(said).toEqual(["Checking the photo.", "Reading the ruler.", "Accepted — nice work."]);
  });

  it("muted: nothing spoken, and unmuting doesn't replay the backlog", () => {
    const said: string[] = [];
    const sp = new NarrationSpeaker({ speak: (t) => said.push(t) }, { muted: true });
    sp.offerLine(line(0), true);
    sp.setMuted(false);
    sp.offerLine(line(0), true);
    sp.offerLine(line(1), true);
    expect(said).toEqual(["line 1"]);
  });

  it("not live → never speaks", () => {
    const said: string[] = [];
    const sp = new NarrationSpeaker({ speak: (t) => said.push(t) });
    expect(sp.offerLine(line(0), false)).toBe(false);
    expect(sp.offerFinal(msg(), false)).toBe(false);
    expect(said).toEqual([]);
  });

  it("survives the voice being unavailable (sink throws)", () => {
    const errors: unknown[] = [];
    const sp = new NarrationSpeaker(
      {
        speak: () => {
          throw new Error("voice unavailable");
        },
      },
      { onSinkError: (e) => errors.push(e) },
    );
    expect(() => sp.offerLine(line(0), true)).not.toThrow();
    expect(sp.offerFinal(msg(), true)).toBe(false);
    expect(errors).toHaveLength(2);
  });

  it("speakable collapses whitespace and caps length", () => {
    expect(speakable("  a \n b ")).toBe("a b");
    expect(speakable("x".repeat(500))).toHaveLength(200);
  });
});

// ------------------------------------------------------------------ explain card

describe("Grokbot message view", () => {
  const full = msg({
    headline: "  Let's fix the shot ",
    paragraphs: ["The ruler wasn't readable.", "  "],
    next_steps: ["Get closer to the ruler."],
    citations: [
      { kind: "stage", ref: "protocol", detail: null },
      { kind: "reason_code", ref: "BLURRY", detail: null },
      { kind: "reason_code", ref: "AI_GENERATED", detail: null },
      { kind: "reason_code", ref: "SOME_FUTURE_CODE", detail: null },
      { kind: "extracted_field", ref: "depth_cm", detail: "not readable" },
      { kind: "price_reason", ref: "Few readings here", detail: null },
      { kind: "stage", ref: "protocol", detail: null },
      { kind: "brand_new_kind", ref: "x", detail: null },
    ],
    source: "template",
  });

  it("renders headline, paragraphs, next steps and plain-language citations", () => {
    const v = grokbotCardView(full);
    expect(v.headline).toBe("Let's fix the shot");
    expect(v.paragraphs).toEqual(["The ruler wasn't readable."]);
    expect(v.nextSteps).toEqual(["Get closer to the ruler."]);
    expect(v.templated).toBe(true);
    expect(v.why).toContain("The photo was blurry. Hold the phone steady and try again.");
    expect(v.why).toContain("What we read from your photo (depth cm): not readable");
    expect(v.why).toContain("Price factor: Few readings here");
    expect(v.why.filter((w) => w.startsWith("Check “"))).toHaveLength(1); // deduped
    // integrity codes, unknown codes and unknown kinds without detail are dropped
    expect(v.why.join(" ")).not.toMatch(/AI_GENERATED|SOME_FUTURE_CODE|brand_new_kind/);
    for (const w of v.why) expect(w).not.toMatch(/reason_code|extracted_field|price_reason/);
  });

  it("integrity rejects show no citations at all", () => {
    expect(grokbotCardView(full, { integrityReject: true }).why).toEqual([]);
  });

  it("citationText never shows a raw integrity code", () => {
    expect(citationText({ kind: "reason_code", ref: "SCREEN_RECAPTURE", detail: "moire" })).toBeNull();
  });

  it("parses a server message leniently", () => {
    const m = LenientGrokbotMessageSchema.parse({ headline: "Hi", paragraphs: [], next_steps: [], citations: [] });
    expect(m.source).toBe("template");
  });

  it("explain errors: not deployed → calm copy; others → toUserMessage; never raw text", () => {
    expect(explainErrorText(new ApiError(404, "HTTP_404", "GET /x failed (404)"))).toMatch(/isn't available/);
    expect(explainErrorText(new ApiError(0, "NETWORK", "Network error: /x"))).toBe(toUserMessage(new ApiError(0, "NETWORK", "")).message);
    expect(explainErrorText(new Error("TypeError: undefined is not a function"))).not.toMatch(/TypeError/);
  });
});

describe("Why this price?", () => {
  it("uses the server's grounded message when it loads", () => {
    const v = priceWhyView({ ok: true, message: msg({ headline: "Few readings here" }) }, ["x"]);
    expect(v.kind).toBe("message");
  });

  it("falls back to the bounty's own price_reasons when the endpoint fails", () => {
    const v = priceWhyView({ ok: false, error: new ApiError(501, "HTTP_501", "") }, ["Few readings here", "Event is recent", "Few readings here", " "]);
    expect(v).toEqual({ kind: "local", reasons: ["Few readings here", "Event is recent"] });
  });

  it("no reasons at all → a generic sentence, never an error", () => {
    const v = priceWhyView({ ok: false, error: new Error("boom") }, undefined);
    expect(v.kind).toBe("none");
    if (v.kind === "none") expect(v.text).not.toMatch(/boom/);
  });
});

// ------------------------------------------------------------------ profile → match refresh

describe("profile save → match refresh", () => {
  it("refreshes matches after the profile is saved, without waiting for it", async () => {
    const order: string[] = [];
    let resolveRefresh!: () => void;
    await saveProfileAndRefresh(
      {
        saveProfile: async () => void order.push("save"),
        refreshMatches: () => {
          order.push("refresh");
          return new Promise<void>((r) => (resolveRefresh = r));
        },
        onRefreshed: () => order.push("refreshed"),
      },
      { occupation: "civil engineer" },
    );
    expect(order).toEqual(["save", "refresh"]); // returned before the refresh finished
    resolveRefresh();
    await flush();
    expect(order).toEqual(["save", "refresh", "refreshed"]);
  });

  it("ignores refresh failures (including a not-yet-deployed endpoint)", async () => {
    const onErr = vi.fn();
    await expect(
      saveProfileAndRefresh(
        { saveProfile: async () => undefined, refreshMatches: async () => Promise.reject(new ApiError(404, "HTTP_404", "")), onRefreshError: onErr },
        {},
      ),
    ).resolves.toBeUndefined();
    await flush();
    expect(onErr).toHaveBeenCalledOnce();
  });

  it("doesn't refresh when the save fails (the save error propagates)", async () => {
    const refresh = vi.fn(async () => undefined);
    await expect(saveProfileAndRefresh({ saveProfile: async () => Promise.reject(new Error("x")), refreshMatches: refresh }, {})).rejects.toThrow();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("list fields respect the contract limits", () => {
    expect(splitList("surveying, GIS,, surveying ; drones")).toEqual(["surveying", "GIS", "drones"]);
    expect(splitList(Array.from({ length: 40 }, (_, i) => `s${i}`).join(","))).toHaveLength(30);
    expect(splitList("x".repeat(100))[0]).toHaveLength(60);
    expect(areasFromText("Midtown, Piedmont Park")).toEqual([
      { label: "Midtown", description: "" },
      { label: "Piedmont Park", description: "" },
    ]);
  });
});

// ------------------------------------------------------------------ economy copy

describe("budget / funding refusals", () => {
  it("BUDGET_EXHAUSTED and pending-funding codes get friendly, non-technical copy", () => {
    for (const code of ["BUDGET_EXHAUSTED", "POOL_EXHAUSTED", "PENDING_FUNDING", "NOT_FUNDED", "BOUNTY_NOT_ACTIVE"]) {
      const m = toUserMessage(new ApiError(409, code, "Bounty 123 budget_remaining_cents < worst case"));
      expect(m.message).not.toMatch(/cents|worst|409|budget_remaining/);
      expect(m.message).toMatch(/later|another bounty/);
      expect(m.retryable).toBe(false);
    }
  });
});
