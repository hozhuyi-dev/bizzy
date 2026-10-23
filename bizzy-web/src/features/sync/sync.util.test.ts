import { describe, expect, test } from "vitest";
import { shortRunText } from "./sync.util";
import type { SyncView } from "./sync.types";

describe("shortRunText", () => {
  const now = new Date("2026-10-23T10:00:00Z");
  const ran = (at: string, error?: string) => ({ at, read: 0, refused: 0, error }) as SyncView;

  test("says how long ago it last ran", () => {
    expect(shortRunText(ran("2026-10-23T09:59:30Z"), false, false, now)).toBe("just now");
    expect(shortRunText(ran("2026-10-23T09:55:00Z"), false, false, now)).toBe("5m ago");
    expect(shortRunText(ran("2026-10-23T07:00:00Z"), false, false, now)).toBe("3h ago");
    expect(shortRunText(ran("2026-10-21T10:00:00Z"), false, false, now)).toBe("2d ago");
  });

  test("says when it runs, failed or never ran", () => {
    expect(shortRunText(ran("2026-10-23T09:55:00Z"), true, false, now)).toBe("Syncing…");
    expect(shortRunText(ran("2026-10-23T09:55:00Z"), false, true, now)).toBe("Syncing…");
    expect(shortRunText(ran("2026-10-23T09:55:00Z", "Google refused"), false, false, now)).toBe("Failed");
    expect(shortRunText(null, false, false, now)).toBe("Never synced");
    expect(shortRunText(undefined, false, false, now)).toBe("");
  });
});
