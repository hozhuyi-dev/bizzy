import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { payItemOf, withAnswer } from "./remedies.util";
import { reportSettled, waitingBefore } from "./settle.hook";
import type { CallAction, CallStep, OpenStep } from "./remedies.util";
import type { ConflictView } from "~/features/conflicts/conflicts.types";
import { ClientsService } from "~/features/clients/clients.service";
import { ConflictsService } from "~/features/conflicts/conflicts.service";
import { DocumentsService } from "~/features/documents/documents.service";
import { PackagesService } from "~/features/packages/packages.service";
import { PaymentsService } from "~/features/payments/payments.service";
import { SessionsService } from "~/features/sessions/sessions.service";
import { toastWithQuip } from "~/components/shared/quip/quip-toast";
import { QUIPS } from "~/core/constants/quips.constant";
import { invalidateBilling } from "~/core/utils/query.util";

/** What each remedy the app takes right there does. */
const CALLS: Record<CallAction, (target: string, request: Record<string, unknown>) => Promise<unknown>> = {
  "calendar.revert": (eventId) => ConflictsService.revert(eventId),
  "clients.update": (id, request) => ClientsService.update(id, request),
  "documents.cancel": (id) => DocumentsService.cancel(id, "To change what it says"),
  "payments.set": (target) => {
    const item = payItemOf(target);
    if (!item) throw new Error("There is no payment to undo.");
    return PaymentsService.set({ items: [item], payment: null });
  },
  "packages.makeStandalone": (id) => PackagesService.makeStandalone(id),
  "sessions.delete": (id) => SessionsService.delete(id, true),
  "sessions.update": (id, request) => SessionsService.update(id, request),
};

/**
 * Takes the remedies the API offers with a refusal: right there (`call`),
 * or by opening the page where the user does it (`open`). `conflict` is the
 * calendar edit they are offered for, if any. The API tries it again once
 * a remedy changes what refused it, so a call says in its toast whether
 * the edit went in; a page opened for it comes back to the to-do list once
 * saved, and says so then (see useSettleReturn). Putting bizzy's version
 * back settles the edit itself.
 */
export function useRemedy(conflict?: ConflictView) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const settle = conflict?.eventId;

  /** Resolves once its toast is shown; rejects with the refusal, to show with its own remedies. */
  const call = async (step: CallStep, cents?: number) => {
    const before = waitingBefore(queryClient);
    setPending(true);
    try {
      try {
        await CALLS[step.action](step.target, withAnswer(step, cents));
      } finally {
        await invalidateBilling(queryClient);
      }
      if (settle && step.action !== "calendar.revert") {
        await reportSettled(queryClient, settle, before, step.done, step.quip);
      } else {
        if (step.quip) toastWithQuip(step.done, QUIPS.todoDone);
        else toast.success(step.done);
      }
    } finally {
      setPending(false);
    }
  };

  const open = (step: OpenStep) => {
    switch (step.kind) {
      case "open":
        return void navigate({ to: step.to, params: { id: step.id }, search: settle ? { from: "home", settle } : {} });
      case "open-new-client":
        return void navigate({ to: "/clients/new", search: { name: step.name, settle } });
      case "open-packages":
        return void navigate({ to: "/packages", search: { new: step.clientId ?? "", settle } });
    }
  };

  return { call, open, pending };
}
