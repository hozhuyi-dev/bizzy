import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { payItemOf, remedyStep } from "./remedies.util";
import type { CallAction } from "./remedies.util";
import type { Remedy } from "~/core/lambda/lambda.types";
import { ConflictsService } from "~/features/conflicts/conflicts.service";
import { DocumentsService } from "~/features/documents/documents.service";
import { PackagesService } from "~/features/packages/packages.service";
import { PaymentsService } from "~/features/payments/payments.service";
import { SessionsService } from "~/features/sessions/sessions.service";
import { invalidateBilling } from "~/core/utils/query.util";

/** What each remedy the app takes right there does. */
const CALLS: Record<CallAction, (target: string, request: Record<string, unknown>) => Promise<unknown>> = {
  "calendar.revert": (eventId) => ConflictsService.revert(eventId),
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
 * Takes the remedies the API offers with a refusal: right there, or by
 * opening the page where the user does it. `applyAfter` is the event of the
 * conflict the remedy was taken from: once a remedy taken right there lets
 * its edit through, the edit is applied too (an edit made allowed any other
 * way waits for the user to apply it). Putting bizzy's version back settles
 * the conflict itself.
 */
export function useRemedy() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  const run = async (remedy: Remedy, applyAfter?: string) => {
    const step = remedyStep(remedy);
    switch (step?.kind) {
      case "call":
        setPending(true);
        try {
          await CALLS[step.action](step.target, step.request);
          if (applyAfter && step.action !== "calendar.revert") await ConflictsService.apply(applyAfter);
        } finally {
          setPending(false);
          void invalidateBilling(queryClient);
        }
        return;
      case "open":
        return void navigate({ to: step.to, params: { id: step.id } });
      case "open-new-client":
        return void navigate({ to: "/clients/new", search: { name: step.name } });
      case "open-packages":
        return void navigate({ to: "/packages" });
    }
  };

  return { run, pending };
}
