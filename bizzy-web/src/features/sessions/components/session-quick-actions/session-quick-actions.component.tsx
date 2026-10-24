import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { NotebookPenIcon } from "lucide-react";
import { useSessionQuickActions } from "../../session-quick-actions.hook";
import { SessionsMutation } from "../../sessions.mutation";
import type { SessionReturnTo, SessionView } from "../../sessions.types";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { ActionButton } from "~/components/shared/actions/action-bar/action-bar.component";
import { InlineField } from "~/components/shared/actions/inline-action/inline-action.component";
import { toastWithQuip } from "~/components/shared/feedback/quip/quip.util";
import { Button } from "~/components/ui/button";
import { QUIPS } from "~/core/constants/quips.constant";

interface SessionQuickActionsProps {
  session: SessionView;
  /** Asks to cancel it (a dialog the list keeps). */
  onCancel: (session: SessionView) => void;
  /** Where the session's page goes back to, from Another day and Write full notes. */
  from?: SessionReturnTo | undefined;
}

/**
 * A session's quick actions (useSessionQuickActions) as buttons of their
 * own, for a row that lays out its own (the to-do list, a client's
 * timeline): Add summary swaps them for the one line, in place, until it
 * is saved.
 */
export function SessionQuickActions({ session, onCancel, from }: SessionQuickActionsProps) {
  const [writing, setWriting] = useState(false);
  const quick = useSessionQuickActions();

  if (writing) return <SummaryField session={session} from={from} onDone={() => setWriting(false)} />;
  const actions = quick(session, {
    page: { to: "/sessions/$id", params: { id: session.id }, search: { from } },
    onCancel,
    onAddSummary: () => setWriting(true),
  });
  return actions.map((action) => <ActionButton key={action.label} action={action} size="sm" />);
}

interface SummaryFieldProps {
  session: SessionView;
  from: SessionReturnTo | undefined;
  onDone: () => void;
}

/**
 * The one line that clears "Record", written in place of the buttons.
 * Long notes are on the session's page; the summary alone leaves them as
 * they are.
 */
function SummaryField({ session, from, onDone }: SummaryFieldProps) {
  const save = SessionsMutation.useSaveSummary();

  return (
    <InlineField
      label="Summary"
      placeholder="One line on the session"
      maxLength={300}
      pending={save.isPending}
      onCancel={onDone}
      onSave={(summary) =>
        save.mutate(
          { id: session.id, summary },
          {
            onSuccess: () => {
              toastWithQuip("Summary saved", QUIPS.todoDone);
              onDone();
            },
            onError: toastRefusal,
          },
        )
      }
      extra={
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Write full notes"
          title="Write full notes"
          render={<Link to="/sessions/$id" params={{ id: session.id }} search={{ from }} hash="record" />}
          nativeButton={false}
        >
          <NotebookPenIcon />
        </Button>
      }
    />
  );
}
