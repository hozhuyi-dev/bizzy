import type { TodoFilter, TodoGroup, TodoItem } from "./todo.types";
import type { Package } from "~/features/packages/packages.types";
import type { Payable } from "~/features/payments/payments.types";
import type { Session } from "~/features/sessions/sessions.types";
import { addDays, startOfDay } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

export function matchesFilter(item: TodoItem, filter: TodoFilter | undefined): boolean {
  if (!filter) return true;
  switch (item.kind) {
    case "followUp":
      return filter === "followUp";
    case "conflict":
      return filter === "fix";
    case "package":
      return filter === "collect";
    case "session":
      return item.reasons.includes(filter as Session["todo"][number]);
  }
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
      return `s:${item.session.id}`;
    case "package":
      return `p:${item.package.id}`;
    case "followUp":
      return `f:${item.followUp.id}`;
    case "conflict":
      return `c:${item.conflict.key}`;
  }
}

/**
 * The session to open after this one: the next session on the to-do list,
 * wrapping round, so she can work through it in one go.
 */
export function nextTodoSession(items: ReadonlyArray<TodoItem> | undefined, current: string): string | undefined {
  const sessions = (items ?? []).flatMap((item) => (item.kind === "session" ? [item.session.id] : []));
  const others = sessions.filter((id) => id !== current);
  if (others.length === 0) return undefined;
  const at = sessions.indexOf(current);
  if (at < 0) return others[0];
  return sessions.slice(at + 1).find((id) => id !== current) ?? others[0];
}

/** What to collect on a session: its fee and the package bought in it, each still owed. */
export function sessionPayables(session: Session): Array<Payable> {
  const payables: Array<Payable> = [];
  const bought = session.boughtOwedCents ?? 0;
  if (session.owedCents > bought) {
    payables.push({ item: { kind: "session", id: session.id }, label: "Session fee", dueCents: session.feeCents });
  }
  if (bought > 0 && session.boughtPackageId) {
    payables.push({ item: { kind: "package", id: session.boughtPackageId }, label: "Package", dueCents: bought });
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
