import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import { ActionButton, ActionMenu } from "~/components/shared/actions/action-bar/action-bar.component";

/** A row's actions: those always in view, and the rest behind ⋯ (edit, delete). */
export interface RowActionSet {
  actions: Array<Action>;
  more?: Array<Action> | undefined;
}

/**
 * The table's actions column: each action as a quiet icon-and-label button,
 * the rest behind ⋯. A row with nothing to do renders nothing.
 */
export function RowActions({ actions, more = [] }: { actions: ReadonlyArray<Action>; more?: ReadonlyArray<Action> | undefined }) {
  if (actions.length === 0 && more.length === 0) return null;
  return (
    <div className="flex items-center justify-end gap-0.5">
      {actions.map((action) => (
        <ActionButton key={action.label} action={action} size="sm" defaultStyle="quiet" />
      ))}
      <ActionMenu actions={more} size="sm" />
    </div>
  );
}
