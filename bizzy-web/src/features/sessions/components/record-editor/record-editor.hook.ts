import { useEffect, useRef, useState } from "react";
import { SessionsMutation } from "../../sessions.mutation";
import type { Session } from "../../sessions.types";

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
