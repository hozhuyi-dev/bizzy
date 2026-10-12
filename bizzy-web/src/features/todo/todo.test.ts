import { describe, expect, test } from "vitest";
import { nextTodoSession } from "./todo.query";
import { groupOf, matchesFilter } from "./todo.types";
import type { TodoItem } from "./todo.types";
import type { Session, TodoReason } from "~/features/sessions/sessions.types";

function sessionItem(eventId: string, at: string, reasons: Array<TodoReason>): TodoItem {
  return { kind: "session", at, reasons, session: { eventId } as Session };
}

const followUp: TodoItem = {
  kind: "followUp",
  at: "2026-10-12T10:00:00",
  followUp: { eventId: "f1", title: "! Jane", due: "2026-10-12T10:00:00", version: 1 },
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
  });

  test("the next session wraps round and skips follow-ups", () => {
    const items = [sessionItem("a", "", ["record"]), followUp, sessionItem("b", "", ["collect"])];
    expect(nextTodoSession(items, "a")).toBe("b");
    expect(nextTodoSession(items, "b")).toBe("a");
    expect(nextTodoSession(items, "gone")).toBe("a");
    expect(nextTodoSession([sessionItem("a", "", ["record"])], "a")).toBeUndefined();
  });
});
