import { toast } from "sonner";
import { ConflictsMutation } from "../../conflicts.mutation";
import type { ConflictView } from "../../conflicts.types";
import { RemedyButtons, toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { Button } from "~/components/ui/button";

/**
 * The ways out of a refused calendar edit: its remedies (putting bizzy's
 * version back among them), and applying it again once what refused it is
 * settled some other way, such as in the app or the calendar.
 */
export function ConflictActions({ conflict, size = "sm" }: { conflict: ConflictView; size?: "xs" | "sm" }) {
  const apply = ConflictsMutation.useApply();
  const done = () => toast.success("Done");

  return (
    <span className="flex flex-wrap gap-1.5">
      <RemedyButtons remedies={conflict.remedies} applyAfter={conflict.eventId} size={size} onDone={done} />
      <Button
        size={size}
        variant="ghost"
        disabled={apply.isPending}
        onClick={() => apply.mutate(conflict.eventId, { onSuccess: () => toast.success("Applied"), onError: toastRefusal })}
      >
        Apply it
      </Button>
    </span>
  );
}
