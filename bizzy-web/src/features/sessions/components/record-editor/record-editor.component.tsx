import type { RecordDraft, SaveState } from "./record-editor.hook";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";

const STATE_LABELS: Record<SaveState, string> = {
  saved: "Saved",
  unsaved: "Not saved yet",
  saving: "Saving…",
  error: "Not saved",
};

export function RecordEditor({ draft, disabled }: { draft: RecordDraft; disabled?: string | undefined }) {
  if (disabled) return <p className="text-sm text-muted-foreground">{disabled}</p>;

  return (
    <>
      <Field>
        <FieldLabel htmlFor="record-summary">Summary</FieldLabel>
        <Input
          id="record-summary"
          value={draft.summary}
          maxLength={300}
          placeholder="L4/L5 mobilisation, pain 6 → 3"
          onChange={(e) => draft.setSummary(e.target.value)}
        />
        <FieldDescription>One line, shown on the client's timeline.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="record-notes">Notes</FieldLabel>
        <Textarea
          id="record-notes"
          className="min-h-40"
          value={draft.notes}
          placeholder="Assessment, treatment, home exercises, what to check next time…"
          onChange={(e) => draft.setNotes(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
        <span role="status" className={draft.state === "error" ? "text-destructive" : undefined}>
          {draft.state === "error" && draft.error ? `${STATE_LABELS.error}: ${draft.error}` : STATE_LABELS[draft.state]}
        </span>
      </div>
    </>
  );
}
