import type { Action } from "~/components/shared/action-bar/action-bar.component";
import { ActionButton, ActionMenu } from "~/components/shared/action-bar/action-bar.component";

/**
 * The table's actions column: each action as a quiet icon-and-label button. A
 * row with nothing to do renders nothing.
 */
export function RowActionButtons({ actions }: { actions: ReadonlyArray<Action> }) {
  if (actions.length === 0) return null;
  return (
    <div className="flex justify-end">
      {actions.map((action) => (
        <ActionButton key={action.label} action={action} size="sm" defaultStyle="quiet" />
      ))}
    </div>
  );
}

/** The phone card's version of the actions column: the same actions behind ⋯. */
export function RowActionMenu({ actions }: { actions: ReadonlyArray<Action> }) {
  return <ActionMenu actions={actions} size="sm" />;
}
