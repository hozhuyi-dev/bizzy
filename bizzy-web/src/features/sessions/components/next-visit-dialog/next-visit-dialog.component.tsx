import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { SessionsMutation } from "../../sessions.mutation";
import type { SessionDraft } from "../../sessions.types";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { formatSessionTime, toISODate } from "~/core/utils/date.util";

interface NextVisitDialogProps {
  /** The session to book after, as its draft; null closes the dialog. */
  from: SessionDraft | null;
  clientName: string;
  onClose: () => void;
}

/**
 * Books the client's next visit in a couple of taps: the same weekday and
 * time a week on, same length and place, priced as usual (a package credit
 * or the default fee).
 */
export function NextVisitDialog({ from, clientName, onClose }: NextVisitDialogProps) {
  return (
    <Dialog open={from !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>{from && <NextVisitForm from={from} clientName={clientName} onClose={onClose} />}</DialogContent>
    </Dialog>
  );
}

function NextVisitForm({ from, clientName, onClose }: { from: SessionDraft; clientName: string; onClose: () => void }) {
  const create = SessionsMutation.useCreate();
  const navigate = useNavigate();
  const start = new Date(from.start);
  const next = new Date(start);
  next.setDate(start.getDate() + 7);
  const pad = (n: number) => String(n).padStart(2, "0");
  const [date, setDate] = useState(toISODate(next));
  const [time, setTime] = useState(`${pad(start.getHours())}:${pad(start.getMinutes())}`);
  const [tentative, setTentative] = useState(false);

  const book = () => {
    const draft: SessionDraft = {
      clientId: from.clientId,
      start: new Date(`${date}T${time}`).toISOString(),
      minutes: from.minutes,
      homeVisit: from.homeVisit,
      tentative,
    };
    create.mutate(draft, {
      onSuccess: (created) => {
        toast.success(`Booked ${clientName} for ${formatSessionTime(draft.start)}`, {
          action: {
            label: "Open",
            onClick: () => void navigate({ to: "/sessions/$id", params: { id: created.eventId } }),
          },
        });
        onClose();
      },
      onError: (error) => toast.error(error.message),
    });
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        book();
      }}
    >
      <DialogHeader>
        <DialogTitle>Book {clientName}'s next visit</DialogTitle>
        <DialogDescription>
          {from.minutes} minutes{from.homeVisit ? ", home visit" : ""}, added to your calendar.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <div className="flex flex-wrap gap-4">
          <Field className="w-auto">
            <FieldLabel htmlFor="next-date">Day</FieldLabel>
            <Input id="next-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field className="w-auto">
            <FieldLabel htmlFor="next-time">Start</FieldLabel>
            <Input id="next-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Field orientation="horizontal">
          <Checkbox id="next-tentative" checked={tentative} onCheckedChange={setTentative} />
          <FieldContent>
            <FieldLabel htmlFor="next-tentative">Not confirmed yet</FieldLabel>
            <FieldDescription>Comes up on your to-do list a few days before, to confirm.</FieldDescription>
          </FieldContent>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!date || !time || create.isPending}>
          {create.isPending ? "Booking…" : "Book"}
        </Button>
      </DialogFooter>
    </form>
  );
}
