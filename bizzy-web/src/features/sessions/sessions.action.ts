import { PlusIcon } from "lucide-react";
import type { Action } from "~/components/shared/action-bar/action-bar.component";

/** Opens NewSessionDialog, to add a session to her calendar. */
export function newSessionAction(onClick: () => void): Action {
  return {
    type: "button",
    label: "New session",
    icon: PlusIcon,
    style: "primary",
    iconOnlyOnPhone: true,
    onClick,
  };
}
