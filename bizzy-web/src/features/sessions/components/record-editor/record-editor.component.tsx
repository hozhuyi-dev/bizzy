import { useEffect, useRef, useState } from "react";
import { PaperclipIcon } from "lucide-react";
import { SessionsMutation } from "../../sessions.mutation";
import type { Session } from "../../sessions.types";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";

/** How long she pauses before what she typed is saved. */
const SAVE_AFTER_MS = 1200;

export type SaveState = "saved" | "unsaved" | "saving" | "error";

export interface RecordDraft {
  summary: string;
  notes: string;
  setSummary: (summary: string) => void;
  setNotes: (notes: string) => void;
  state: SaveState;
  error?: string | undefined;
}

/**
 * The summary and notes as she types them, saved after each pause, and
 * once more if she leaves with something unsaved, so nothing written about
 * a client is ever lost. The page reads the summary from here, so the rail
 * shows what she typed before it is saved.
 */
export function useRecordDraft(session: Session, savedNotes: string): RecordDraft {
  const save = SessionsMutation.useSaveRecord();
  const [summary, setSummary] = useState(session.record?.summary ?? "");
  const [notes, setNotes] = useState(savedNotes);
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState<string>();
  const saved = useRef({ summary, notes });
  const latest = useRef({ summary, notes });
  useEffect(() => {
    latest.current = { summary, notes };
  });
  const { mutateAsync } = save;
  const eventId = session.eventId;

  useEffect(() => {
    if (summary === saved.current.summary && notes === saved.current.notes) return undefined;
    setState("unsaved");
    const timer = setTimeout(() => {
      const sending = { summary, notes };
      setState("saving");
      mutateAsync({ eventId, ...sending })
        .then(() => {
          saved.current = sending;
          const { summary: s, notes: n } = latest.current;
          setState(s === sending.summary && n === sending.notes ? "saved" : "unsaved");
          setError(undefined);
        })
        .catch((e: unknown) => {
          setState("error");
          setError(e instanceof Error ? e.message : "Couldn't save");
        });
    }, SAVE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [summary, notes, eventId, mutateAsync]);

  // Leaving mid-pause still saves what she typed.
  useEffect(
    () => () => {
      const { summary: s, notes: n } = latest.current;
      if (s !== saved.current.summary || n !== saved.current.notes) {
        void mutateAsync({ eventId, summary: s, notes: n }).catch(() => undefined);
      }
    },
    [eventId, mutateAsync],
  );

  return { summary, notes, setSummary, setNotes, state, error };
}

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
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <PaperclipIcon className="size-3.5" aria-hidden="true" /> Attaching photos and PDFs is coming soon.
        </span>
        <span role="status" className={draft.state === "error" ? "text-destructive" : undefined}>
          {draft.state === "error" && draft.error ? `${STATE_LABELS.error}: ${draft.error}` : STATE_LABELS[draft.state]}
        </span>
      </div>
    </>
  );
}
