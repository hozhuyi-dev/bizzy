import { useState } from "react";
import { toast } from "sonner";
import { DocumentsMutation } from "../../documents.mutation";
import type { DocumentView } from "../../documents.types";
import { SessionsQuery } from "~/features/sessions/sessions.query";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { SheetDialog } from "~/components/shared/sheet-dialog/sheet-dialog.component";
import { Loading } from "~/components/shared/quip/quip.component";
import { pageItems } from "~/core/list/filter.util";
import { formatSessionTime } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

interface AddSessionsDialogProps {
  /** The draft invoice to put them on. */
  doc: DocumentView;
  open: boolean;
  onClose: () => void;
}

/**
 * Puts more of the client's sessions on a draft invoice: those on a draft
 * of their own (or another), not issued yet. The drafts they leave go when
 * they cover nothing else.
 */
export function AddSessionsDialog({ doc, open, onClose }: AddSessionsDialogProps) {
  return (
    <SheetDialog open={open} onClose={onClose}>
      {open && <AddSessions doc={doc} onClose={onClose} />}
    </SheetDialog>
  );
}

function AddSessions({ doc, onClose }: Omit<AddSessionsDialogProps, "open">) {
  const found = SessionsQuery.useSearch({ text: "", when: undefined, chips: { client: [doc.clientId] } });
  const place = DocumentsMutation.usePlace();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  // On another draft invoice: one issued keeps what it covers.
  const others = pageItems(found.data).filter((s) => s.invoice && !s.invoice.number && s.invoice.id !== doc.id);
  const total = others.filter((s) => chosen.has(s.id)).reduce((sum, s) => sum + s.feeCents, 0);

  const toggle = (id: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add sessions</DialogTitle>
        <DialogDescription>Put more of {doc.recipientName}'s sessions on this invoice, from the drafts they are on.</DialogDescription>
      </DialogHeader>
      {found.isPending ? (
        <Loading />
      ) : others.length === 0 ? (
        <p className="text-sm text-muted-foreground">No other session of theirs is on a draft invoice.</p>
      ) : (
        <ul aria-label="Sessions on other drafts" className="flex flex-col gap-2 text-sm">
          {others.map((session) => {
            const id = `add-${session.id}`;
            return (
              <li key={session.id} className="flex items-center gap-3">
                <Checkbox id={id} checked={chosen.has(session.id)} onCheckedChange={(on) => toggle(session.id, on)} />
                <label htmlFor={id} className="flex flex-1 items-center justify-between gap-2">
                  <span>{formatSessionTime(session.start)}</span>
                  <span>{formatCents(session.feeCents)}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={chosen.size === 0 || place.isPending}
          onClick={() =>
            place.mutate(
              { type: "invoice", into: doc.id, items: [...chosen].map((id) => ({ kind: "session", id }) as const) },
              {
                onSuccess: () => {
                  toast.success(`Added ${chosen.size} ${chosen.size === 1 ? "session" : "sessions"}`);
                  onClose();
                },
                onError: toastRefusal,
              },
            )
          }
        >
          {chosen.size > 0 ? `Add ${formatCents(total)}` : "Add"}
        </Button>
      </DialogFooter>
    </>
  );
}
