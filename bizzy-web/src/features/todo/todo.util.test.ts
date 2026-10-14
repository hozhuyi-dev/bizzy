import { describe, expect, test } from "vitest";
import { groupOf, matchesFilter, nextTodoSession } from "./todo.util";
import type { TodoItem } from "./todo.types";
import type { Conflict } from "~/features/conflicts/conflicts.types";
import type { Session, TodoReason } from "~/features/sessions/sessions.types";

function sessionItem(id: string, at: string, reasons: Array<TodoReason>): TodoItem {
  return { kind: "session", at, reasons, session: { id } as Session };
}

const conflict: TodoItem = {
  kind: "conflict",
  at: "2026-10-12T08:00:00",
  reasons: ["fix"],
  conflict: { key: "calendar#e1" } as Conflict,
};

const followUp: TodoItem = {
  kind: "followUp",
  at: "2026-10-12T10:00:00",
  reasons: ["followUp"],
  followUp: { id: "f1", clientId: "jane", due: "2026-10-12T10:00:00", event: {}, createdAt: "2026-10-01T00:00:00Z", version: 1 },
};

describe("to-do list", () => {
  const now = new Date("2026-10-12T09:00:00");

  test("groups by day in her time zone", () => {
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
