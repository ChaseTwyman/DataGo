import { describe, expect, it } from "vitest";
import { breadcrumbs, relativeLabel } from "@/components/ds/format";

describe("breadcrumbs", () => {
  it("labels known segments and links every level", () => {
    expect(breadcrumbs("/admin/users")).toEqual([
      { href: "/admin", label: "Admin" },
      { href: "/admin/users", label: "Users" },
    ]);
  });

  it("shortens ids and survives malformed escapes", () => {
    const [, id] = breadcrumbs("/bounties/2f1c9a1e-8b7d-4c1e-9f00-1234567890ab");
    expect(id?.label).toBe("#2f1c9a1e");
    expect(breadcrumbs("/x/%E0%A4%A")[1]?.label).toBe("%E0%A4%A");
  });

  it("is empty for the root", () => {
    expect(breadcrumbs("/")).toEqual([]);
  });
});

describe("relativeLabel", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  it("past and future", () => {
    expect(relativeLabel("2026-09-26T11:55:00Z", now)).toBe("5m ago");
    expect(relativeLabel("2026-09-26T15:00:00Z", now)).toBe("in 3h");
  });
  it("bad input is a dash, not NaN", () => {
    expect(relativeLabel("not a date", now)).toBe("—");
  });
});
