import type { TodoFilter, TodoGroup, TodoItem } from "./todo.types";
import type { Package } from "~/features/packages/packages.types";
import type { Payable } from "~/features/payments/payments.types";
import type { Session, TodoReason } from "~/features/sessions/sessions.types";
import { addDays, startOfDay } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

export function matchesFilter(item: TodoItem, filter: TodoFilter | undefined): boolean {
  if (!filter) return true;
  if (item.kind === "followUp") return filter === "followUp" || (filter === "fix" && Boolean(item.reasons?.includes("fix")));
  return item.reasons.includes(filter as TodoReason);
}

/** Which day group an item falls in, in her time zone. */
export function groupOf(item: TodoItem, now = new Date()): TodoGroup {
  const at = new Date(item.at);
  const startOfToday = startOfDay(now);
  if (at < startOfToday) return "overdue";
  if (at < addDays(startOfToday, 1)) return "today";
  return "upcoming";
}

/** A stable key for an item. */
export function todoKey(item: TodoItem): string {
  switch (item.kind) {
    case "session":
      return `s:${item.session.eventId}`;
    case "package":
      return `p:${item.package.id}`;
    case "followUp":
      return `f:${item.followUp.eventId}`;
  }
}

/**
 * The session to open after this one: the next session on the to-do list,
 * wrapping round, so she can work through it in one go.
 */
export function nextTodoSession(items: ReadonlyArray<TodoItem> | undefined, current: string): string | undefined {
  const sessions = (items ?? []).flatMap((item) => (item.kind === "session" ? [item.session.eventId] : []));
  const others = sessions.filter((id) => id !== current);
  if (others.length === 0) return undefined;
  const at = sessions.indexOf(current);
  if (at < 0) return others[0];
  return sessions.slice(at + 1).find((id) => id !== current) ?? others[0];
}

/** What to collect on a session: its fee and the package it bought, each still due. */
export function sessionPayables(session: Session): Array<Payable> {
  const payables: Array<Payable> = [];
  if (session.owedCents > session.boughtOwedCents) {
    payables.push({ item: { kind: "session", id: session.eventId }, label: "Session fee", dueCents: session.dueCents });
  }
  if (session.boughtOwedCents > 0) {
    payables.push({ item: { kind: "package", id: session.eventId }, label: "Package", dueCents: session.boughtOwedCents });
  }
  return payables;
}

export function packagePayable(pkg: Package): Payable {
  return { item: { kind: "package", id: pkg.id }, label: `Package of ${pkg.sessions}`, dueCents: pkg.priceCents };
}

/** "RM 95 due", or "RM 95 + package RM 850 due" when both are. */
export function owedText(payables: ReadonlyArray<Payable>, owed: number): string {
  const [fee, pkg] = payables;
  if (fee && pkg) return `${formatCents(fee.dueCents)} + package ${formatCents(pkg.dueCents)} due`;
  if (fee?.item.kind === "package") return `package ${formatCents(owed)} due`;
  return `${formatCents(owed)} due`;
}
