import { toast } from "sonner";
import { useRemedy } from "../../remedies.hook";
import { remedyStep } from "../../remedies.util";
import type { Remedy } from "~/core/lambda/lambda.types";
import { Button } from "~/components/ui/button";

interface RemedyButtonsProps {
  remedies: ReadonlyArray<Remedy>;
  /** After one is taken. */
  onDone?: () => void;
  /** The event of the conflict they are offered for: its edit is applied once one lets it through. */
  applyAfter?: string;
  size?: "xs" | "sm";
}

/** A refusal's remedies, each a button that takes it: what would let the action through. */
export function RemedyButtons({ remedies, onDone, applyAfter, size = "sm" }: RemedyButtonsProps) {
  const remedy = useRemedy();
  const known = remedies.filter((r) => remedyStep(r) !== undefined);
  if (known.length === 0) return null;

  return (
    <span className="flex flex-wrap gap-1.5">
      {known.map((r) => (
        <Button
          key={`${r.action}:${r.target ?? ""}:${r.label}`}
          size={size}
          variant="outline"
          disabled={remedy.pending}
          onClick={() =>
            void remedy
              .run(r, applyAfter)
              .then(onDone)
              .catch((error: Error) => toastRefusal(error))
          }
        >
          {r.label}
        </Button>
      ))}
    </span>
  );
}

/**
 * Shows why an action was refused, with its remedies as buttons when the
 * API offered any: the app's way to say what to do instead.
 */
export function toastRefusal(error: unknown) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  const remedies = error instanceof Error && "remedies" in error ? (error.remedies as Array<Remedy>) : [];
  if (remedies.length === 0) {
    toast.error(message);
    return;
  }
  const id = toast.error(message, {
    duration: 15_000,
    description: <RemedyButtons remedies={remedies} size="xs" onDone={() => toast.dismiss(id)} />,
  });
}
