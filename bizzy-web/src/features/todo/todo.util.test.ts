import { describe, expect, test } from "vitest";
import { groupOf, matchesFilter, nextTodoSession } from "./todo.util";
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

  test("groups by day in the user's time zone", () => {
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
    expect(matchesFilter(followUp, "fix")).toBe(false);
    expect(matchesFilter(conflict, "fix")).toBe(true);
    expect(matchesFilter(conflict, "record")).toBe(false);
  });

  test("the next session wraps round and skips follow-ups", () => {
    const items = [sessionItem("a", "", ["record"]), followUp, conflict, sessionItem("b", "", ["collect"])];
    expect(nextTodoSession(items, "a")).toBe("b");
    expect(nextTodoSession(items, "b")).toBe("a");
    expect(nextTodoSession(items, "gone")).toBe("a");
    expect(nextTodoSession([sessionItem("a", "", ["record"])], "a")).toBeUndefined();
  });
});
