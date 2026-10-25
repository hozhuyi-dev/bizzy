import { describe, expect, test } from "vitest";
import { groupOf, matchesFilter, progressOf, todoIds, withSession } from "./todo.util";
import type { TodoView } from "./todo.types";
import type { ConflictView } from "~/features/conflicts/conflicts.types";
import type { FollowUpView } from "~/features/follow-ups/follow-ups.types";
import type { SessionReason, SessionView } from "~/features/sessions/sessions.types";

function sessionItem(id: string, at: string, todo: Array<SessionReason>): TodoView {
  return { kind: "session", at, session: { id, todo } as SessionView };
}

const conflict: TodoView = {
  kind: "conflict",
  at: "2026-10-12T08:00:00",
  conflict: { eventId: "e1" } as ConflictView,
};

const followUp: TodoView = {
  kind: "followUp",
  at: "2026-10-12T10:00:00",
  followUp: { id: "f1", clientId: "jane", due: "2026-10-12T10:00:00", todo: ["followUp"] } as FollowUpView,
};

describe("to-do list", () => {
  const now = new Date("2026-10-12T09:00:00");

  test("groups calendar edits first, the rest by day in the user's time zone", () => {
    expect(groupOf(conflict, now)).toBe("calendar");
    expect(groupOf(sessionItem("a", "2026-10-11T23:00:00", ["record"]), now)).toBe("overdue");
    expect(groupOf(followUp, now)).toBe("today");
    expect(groupOf(sessionItem("b", "2026-10-13T08:00:00", ["confirm"]), now)).toBe("upcoming");
  });

  test("filters by reason or follow-ups", () => {
    const item = sessionItem("a", "2026-10-11T23:00:00", ["record", "collect"]);
    expect(matchesFilter(item, "collect")).toBe(true);
    expect(matchesFilter(item, "followUp")).toBe(false);
    expect(matchesFilter(followUp, "followUp")).toBe(true);
    expect(matchesFilter(followUp, undefined)).toBe(true);
    expect(matchesFilter(followUp, "calendar")).toBe(false);
    expect(matchesFilter(conflict, "calendar")).toBe(true);
    expect(matchesFilter(conflict, "record")).toBe(false);
  });

  test("its items of one kind, in order, each once", () => {
    const items = [sessionItem("a", "", ["record"]), followUp, conflict, sessionItem("b", "", ["collect"])];
    expect(todoIds(items, "session")).toEqual(["a", "b"]);
    expect(todoIds([...items, sessionItem("a", "", ["collect"])], "session")).toEqual(["a", "b"]);
    expect(todoIds(items, "followUp")).toEqual(["f1"]);
    expect(todoIds(items, "package")).toEqual([]);
  });
});

describe("progress", () => {
  test("counts what left the list today, and starts again the next day", () => {
    const a = sessionItem("a", "", ["record"]);
    const b = sessionItem("b", "", ["collect"]);
    expect(progressOf([a, b], "2026-10-12")).toEqual({ cleared: 0, left: 2 });
    expect(progressOf([b], "2026-10-12")).toEqual({ cleared: 1, left: 1 });
    // Back on the list (an undo): not cleared after all.
    expect(progressOf([a, b], "2026-10-12")).toEqual({ cleared: 0, left: 2 });
    expect(progressOf([], "2026-10-12")).toEqual({ cleared: 2, left: 0 });
    expect(progressOf([b], "2026-10-13")).toEqual({ cleared: 0, left: 1 });
  });
});

describe("a session just changed", () => {
  test("updates its row, or drops it once nothing is left to do", () => {
    const a = sessionItem("a", "", ["record", "collect"]);
    const items = [a, followUp];
    const recorded = { id: "a", todo: ["collect"] } as SessionView;
    expect(withSession(items, recorded)).toEqual([{ ...a, session: recorded }, followUp]);
    expect(withSession(items, { id: "a", todo: [] } as unknown as SessionView)).toEqual([followUp]);
    expect(withSession(items, { id: "other", todo: ["record"] } as SessionView)).toEqual(items);
  });
});
