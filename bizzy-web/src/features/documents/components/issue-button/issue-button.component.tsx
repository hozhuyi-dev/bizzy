import { StampIcon } from "lucide-react";
import { toast } from "sonner";
import { DocumentsMutation } from "../../documents.mutation";
import { documentLabel } from "../../documents.util";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { Button } from "~/components/ui/button";

/** Issue on a draft, wherever it is listed: it takes its number, and the toast says which. */
export function IssueButton({ id }: { id: string }) {
  const issue = DocumentsMutation.useIssue();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={issue.isPending}
      onClick={() =>
        issue.mutate(id, {
          onSuccess: (view) => {
            if (view?.number) toast.success(`Issued ${documentLabel(view.number, view.revision)}`);
          },
          onError: toastRefusal,
        })
      }
    >
      <StampIcon /> Issue
    </Button>
  );
}
