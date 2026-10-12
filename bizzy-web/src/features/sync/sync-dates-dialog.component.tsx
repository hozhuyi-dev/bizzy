import { useState } from "react";
import type { SyncRange } from "./sync.types";
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
import { toISODate, todayISO } from "~/core/utils/date.util";

interface SyncDatesDialogProps {
  open: boolean;
  onClose: () => void;
  onSync: (range: SyncRange) => void;
}

/** Picks the dates a sync re-reads, or the whole calendar. */
export function SyncDatesDialog({ open, onClose, onSync }: SyncDatesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sync dates</DialogTitle>
          <DialogDescription>
            Re-reads the sessions in these dates from your calendar. Bookings and contacts are
            refreshed too.
          </DialogDescription>
        </DialogHeader>
        {open && <SyncDatesForm onSync={onSync} />}
      </DialogContent>
    </Dialog>
  );
}

function sixtyDaysAgo(): string {
  const start = new Date();
  start.setDate(start.getDate() - 60);
  return toISODate(start);
}

function SyncDatesForm({ onSync }: Pick<SyncDatesDialogProps, "onSync">) {
  const [from, setFrom] = useState(sixtyDaysAgo);
  const [to, setTo] = useState(() => todayISO());
  const [all, setAll] = useState(false);
  const backwards = !all && from !== "" && to !== "" && to < from;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSync(all ? { all: true } : { from, to });
      }}
    >
      <FieldGroup>
        <div className="flex flex-wrap gap-4">
          <Field className="w-auto">
            <FieldLabel htmlFor="sync-from">From</FieldLabel>
            <Input
              id="sync-from"
              type="date"
              required={!all}
              disabled={all}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="max-w-44"
            />
          </Field>
          <Field className="w-auto">
            <FieldLabel htmlFor="sync-to">To</FieldLabel>
            <Input
              id="sync-to"
              type="date"
              required={!all}
              disabled={all}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="max-w-44"
            />
          </Field>
        </div>

        <Field orientation="horizontal">
          <Checkbox id="sync-all" checked={all} onCheckedChange={(checked) => setAll(checked)} />
          <FieldContent>
            <FieldLabel htmlFor="sync-all">All time</FieldLabel>
            <FieldDescription>Every event in the calendar, however old.</FieldDescription>
          </FieldContent>
        </Field>

        {backwards && (
          <p role="alert" className="text-sm text-destructive">
            The end date is before the start date.
          </p>
        )}
      </FieldGroup>

      <DialogFooter className="mt-6">
        <Button type="submit" disabled={backwards}>
          Sync
        </Button>
      </DialogFooter>
    </form>
  );
}
