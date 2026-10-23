import { toast } from "sonner";
import { ConflictsMutation } from "../../conflicts.mutation";
import type { ConflictView } from "../../conflicts.types";
import { RemedyButtons } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { QUIPS } from "~/core/constants/quips.constant";

/**
 * The ways out of a refused calendar edit: its first remedy as a button,
 * the rest (putting bizzy's version back among them) in a menu, with
 * trying it again once what refused it is settled in the calendar. Laid
 * out by its container.
 */
export function ConflictActions({ conflict, size = "sm" }: { conflict: ConflictView; size?: "xs" | "sm" }) {
  const apply = ConflictsMutation.useApply();
  const tryAgain = () =>
    apply.mutate(conflict.eventId, {
      onSuccess: () => toastWithQuip("The calendar edit is in", QUIPS.todoDone),
      onError: (error) => toast.warning("It still can't go in", { description: error.message }),
    });

  return (
    <RemedyButtons
      remedies={conflict.remedies}
      conflict={conflict}
      size={size}
      first
      more={[{ label: "Try again", onClick: tryAgain }]}
    />
  );
}
