import { describe, expect, it } from "vitest";
import { ApiClientError } from "./errors";
import { BRIEFING_TIMEOUT_MS, briefingTick, forgetBriefing, rememberBriefing, rememberedBriefing, startFailed, startRendering, videoKey } from "./briefing";

const supa = (id: string, t = "") => `https://x.supabase.co/storage/v1/object/public/synthetic/briefings/${id}.mp4${t}`;
const local = (id: string, token: string) => `http://localhost:3000/api/dev/media?path=${encodeURIComponent(`synthetic/briefings/${id}.mp4`)}&token=${token}`;

describe("videoKey", () => {
  it("identifies the stored object, ignoring per-request tokens", () => {
    expect(videoKey(null)).toBeNull();
    expect(videoKey(supa("b-1", "?t=1"))).toBe(videoKey(supa("b-1", "?t=2")));
    expect(videoKey(local("b-1", "aaa"))).toBe(videoKey(local("b-1", "bbb")));
    expect(videoKey(local("b-1", "aaa"))).not.toBe(videoKey(local("b-2", "aaa")));
    expect(videoKey("not a url")).toBe("not a url");
  });
});

describe("briefing polling state machine", () => {
  it("first clip: rendering → ready when a URL appears", () => {
    const s = startRendering(null, 1_000);
    expect(briefingTick(s, null, 60_000)).toEqual(s);
    expect(briefingTick(s, supa("b-r1"), 90_000)).toEqual({ phase: "ready" });
  });

  it("regenerate: the old clip's URL does not count as done, a new object does", () => {
    const s = startRendering(local("b-r1", "t1"), 0);
    expect(briefingTick(s, local("b-r1", "t2"), 30_000).phase).toBe("rendering");
    expect(briefingTick(s, local("b-r2", "t3"), 40_000)).toEqual({ phase: "ready" });
  });

  it("gives up after ~6 minutes with a check-back-later state", () => {
    const s = startRendering(null, 0);
    expect(briefingTick(s, null, BRIEFING_TIMEOUT_MS - 1).phase).toBe("rendering");
    expect(briefingTick(s, null, BRIEFING_TIMEOUT_MS + 1)).toEqual({ phase: "timeout" });
    // timeout is terminal (polling stops); the page still renders whatever URL the bounty has on reload
    expect(briefingTick({ phase: "timeout" }, supa("b-late"), BRIEFING_TIMEOUT_MS * 2)).toEqual({ phase: "timeout" });
  });

  it("non-rendering phases are left alone", () => {
    expect(briefingTick({ phase: "idle" }, supa("x"), 0)).toEqual({ phase: "idle" });
    expect(briefingTick({ phase: "error", message: "m" }, null, 0)).toEqual({ phase: "error", message: "m" });
  });

  it("a failed start becomes friendly copy", () => {
    const s = startFailed(new ApiClientError("x", 403, "FORBIDDEN"));
    expect(s.phase).toBe("error");
    if (s.phase === "error") expect(s.message).not.toMatch(/403|FORBIDDEN/);
  });
});

describe("in-flight renders survive leaving the page", () => {
  it("remembers and forgets per bounty", () => {
    rememberBriefing("b1", startRendering(null, 5));
    expect(rememberedBriefing("b1")).toEqual(startRendering(null, 5));
    expect(rememberedBriefing("b2")).toEqual({ phase: "idle" });
    forgetBriefing("b1");
    expect(rememberedBriefing("b1")).toEqual({ phase: "idle" });
  });
});
