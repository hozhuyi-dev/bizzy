import { useState } from "react";
import { toast } from "sonner";
import { Trash2Icon } from "lucide-react";
import { daysFromToday, toFollowUpDraft, toFollowUpValues } from "../../follow-ups.form";
import { FollowUpsMutation } from "../../follow-ups.mutation";
import type { FollowUpValues } from "../../follow-ups.form";
import type { FollowUpTarget } from "../../follow-ups.types";
import { ClientsQuery } from "~/features/clients/clients.query";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";

interface FollowUpDialogProps {
  target: FollowUpTarget | null;
  onClose: () => void;
}

/**
 * Adds or edits a follow-up. It is written to her calendar as
 * `! Name: summary` with the notes as the event's description, so she sees
 * it on her phone too.
 */
export function FollowUpDialog({ target, onClose }: FollowUpDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {target && <FollowUpForm key={target.mode === "edit" ? target.followUp.id : "new"} target={target} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

/** Quick picks, counted from today. */
const IN = [
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
  { label: "3 months", days: 91 },
];

function FollowUpForm({ target, onClose }: { target: FollowUpTarget; onClose: () => void }) {
  const [values, setValues] = useState(() => toFollowUpValues(target));
  const set = <TKey extends keyof FollowUpValues>(key: TKey, value: FollowUpValues[TKey]) =>
    setValues((prev) => ({ ...prev, [key]: value }));
  const clients = ClientsQuery.useList();
  const create = FollowUpsMutation.useCreate();
  const update = FollowUpsMutation.useUpdate();
  const remove = FollowUpsMutation.useDelete();
  const busy = create.isPending || update.isPending || remove.isPending;
  const editing = target.mode === "edit" ? target.followUp : undefined;
  const sessionId = target.mode === "new" ? target.sessionId : undefined;
  const fixedClient = target.mode === "new" && Boolean(target.clientId);

  const items = (clients.data ?? [])
    .map((client) => ({ value: client.id, label: client.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const clientName = items.find((item) => item.value === values.clientId)?.label;
  const valid = values.clientId !== "" && values.date !== "" && (values.allDay || values.time !== "");

  const save = () => {
    const draft = toFollowUpDraft(values, sessionId);
    const done = {
      onSuccess: () => {
        toast.success(editing ? "Follow-up updated" : "Follow-up added to your calendar");
        onClose();
      },
      onError: (error: Error) => toast.error(error.message),
    };
    if (editing) update.mutate({ id: editing.id, draft }, done);
    else create.mutate(draft, done);
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) save();
      }}
    >
      <DialogHeader>
        <DialogTitle>{editing ? "Edit follow-up" : clientName ? `Follow up with ${clientName}` : "New follow-up"}</DialogTitle>
        <DialogDescription>
          Added to your calendar as “! {clientName ?? "Name"}
          {values.summary.trim() ? `: ${values.summary.trim()}` : ""}”.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup>
        {!fixedClient && (
          <Field>
            <FieldLabel>Client</FieldLabel>
            <Select items={items} value={values.clientId} onValueChange={(value) => set("clientId", value ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a client" />
              </SelectTrigger>
              <SelectContent>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        <Field>
          <FieldLabel htmlFor="follow-up-summary">What to follow up</FieldLabel>
          <Input
            id="follow-up-summary"
            value={values.summary}
            maxLength={200}
            placeholder="Check MRI results"
            onChange={(e) => set("summary", e.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="follow-up-date">When</FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="follow-up-date"
              type="date"
              className="w-auto"
              value={values.date}
              onChange={(e) => set("date", e.target.value)}
            />
            {!values.allDay && (
              <Input
                type="time"
                aria-label="Time"
                step={300}
                className="w-auto"
                value={values.time}
                onChange={(e) => set("time", e.target.value)}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {IN.map(({ label, days }) => (
              <Button key={label} type="button" variant="outline" size="xs" onClick={() => set("date", daysFromToday(days))}>
                In {label}
              </Button>
            ))}
          </div>
        </Field>

        <Field orientation="horizontal">
          <Checkbox id="follow-up-all-day" checked={values.allDay} onCheckedChange={(checked) => set("allDay", checked)} />
          <FieldContent>
            <FieldLabel htmlFor="follow-up-all-day">All day</FieldLabel>
            <FieldDescription>Untick to block a time for the call.</FieldDescription>
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="follow-up-notes">Notes</FieldLabel>
          <Textarea
            id="follow-up-notes"
            rows={4}
            value={values.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
          <FieldDescription>Saved as the calendar event's description.</FieldDescription>
        </Field>
      </FieldGroup>

      <DialogFooter className="sm:justify-between">
        {editing ? (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() =>
              remove.mutate(editing.id, {
                onSuccess: () => {
                  toast.success("Follow-up deleted from your calendar");
                  onClose();
                },
                onError: (error) => toast.error(error.message),
              })
            }
          >
            <Trash2Icon /> Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid || busy}>
            {busy ? "Saving…" : editing ? "Save" : "Add follow-up"}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}
