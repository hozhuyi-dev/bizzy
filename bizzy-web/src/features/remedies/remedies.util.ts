import type { Remedy, Verdict } from "~/core/lambda/lambda.types";
import type { ConflictView } from "~/features/conflicts/conflicts.types";
import type { PayItem } from "~/features/payments/payments.types";

/**
 * How the app takes a remedy the API offered with a refusal. Most it takes
 * right there (cancel the invoice, undo the payment, put bizzy's version
 * back in the calendar, confirm the session, add a calendar name), first
 * asking for the one thing it needs (a fee) or making sure of one that
 * can't be taken back; the rest open the page where the user does it, as
 * there is more to fill in (a client's contact, a session's time).
 */
export type RemedyStep = CallStep | OpenStep;

export interface CallStep {
  kind: "call";
  action: CallAction;
  target: string;
  request: Record<string, unknown>;
  /** What the user fills in first; it is merged into the request. */
  ask?: "fee";
  /** Asked before it is taken, as it can't be taken back. */
  confirm?: { question: string; yes: string };
  /** What the toast says once it is taken. */
  done: string;
  /** A quip under that toast: not for money, or for undoing and deleting. */
  quip: boolean;
}

export type OpenStep =
  | { kind: "open"; to: "/sessions/$id" | "/clients/$id"; id: string }
  | { kind: "open-new-client"; name?: string | undefined }
  | { kind: "open-packages"; clientId?: string | undefined };

export type CallAction =
  | "calendar.revert"
  | "clients.update"
  | "documents.cancel"
  | "payments.set"
  | "packages.makeStandalone"
  | "sessions.delete"
  | "sessions.update";

/**
 * How to take a remedy; undefined for one the app doesn't know. `conflict`
 * is the calendar edit it is offered for, if any: putting bizzy's version
 * back over a new event deletes it.
 */
export function remedyStep(remedy: Remedy, conflict?: ConflictView): RemedyStep | undefined {
  const target = remedy.target ?? "";
  const request = remedy.request ?? {};
  const call = (action: CallAction, rest: Pick<CallStep, "done" | "quip"> & Partial<CallStep>): CallStep => ({
    kind: "call",
    action,
    target,
    request,
    ...rest,
  });
  switch (remedy.action) {
    case "calendar.revert":
      if (conflict && !conflict.itemId && !conflict.gone) {
        return call("calendar.revert", {
          done: "Event deleted",
          quip: false,
          confirm: { question: "Delete it from your calendar?", yes: "Delete" },
        });
      }
      return call("calendar.revert", { done: "Put back in your calendar", quip: false });
    case "documents.cancel": {
      const number = remedy.label.replace(/^Cancel /, "");
      return call("documents.cancel", {
        done: `${number} cancelled`,
        quip: false,
        confirm: { question: `Cancel ${number}? It can't be undone.`, yes: `Cancel ${number}` },
      });
    }
    case "payments.set":
      return call("payments.set", {
        done: "Payment undone",
        quip: false,
        confirm: { question: "Undo the payment?", yes: "Undo it" },
      });
    case "packages.makeStandalone":
      return call("packages.makeStandalone", { done: "Kept as a package on its own", quip: false });
    case "sessions.delete":
      return call("sessions.delete", {
        done: "Session deleted",
        quip: false,
        confirm: { question: "Delete it with its notes and files?", yes: "Delete" },
      });
    case "sessions.update":
      // With what to change (confirm it), it is taken right there.
      return remedy.request
        ? call("sessions.update", { done: "Confirmed", quip: true })
        : { kind: "open", to: "/sessions/$id", id: target };
    case "clients.update":
      // With what to change (a calendar name), or the one thing to ask
      // for (a fee), it is taken right there.
      if (remedy.ask === "fee") return call("clients.update", { ask: "fee", done: "Usual fee set", quip: true });
      return remedy.request
        ? call("clients.update", { done: "Calendar name added", quip: true })
        : { kind: "open", to: "/clients/$id", id: target };
    case "clients.create":
      return { kind: "open-new-client", name: typeof request.name === "string" ? request.name : undefined };
    case "packages.create":
      return { kind: "open-packages", clientId: typeof request.clientId === "string" ? request.clientId : undefined };
  }
  return undefined;
}

/** The request once the user has filled in what the step asks for. */
export function withAnswer(step: CallStep, cents: number | undefined): Record<string, unknown> {
  if (step.ask === "fee" && cents !== undefined) return { ...step.request, feeRates: [{ cents }] };
  return step.request;
}

/** The item a payment remedy undoes: "session:<id>" or "package:<id>". */
export function payItemOf(target: string): PayItem | undefined {
  const [kind, id] = target.split(":");
  if ((kind === "session" || kind === "package") && id) return { kind, id };
  return undefined;
}

/**
 * A field's lock says what one of the fields above it already says: its
 * LockedHint only points back (`again`), so a form says each reason once.
 */
export function saidAbove(lock: Verdict | undefined, ...above: ReadonlyArray<Verdict | undefined>): boolean {
  return lock !== undefined && above.some((other) => other?.why === lock.why);
}
