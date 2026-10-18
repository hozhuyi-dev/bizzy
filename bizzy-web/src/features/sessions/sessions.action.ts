import { PlusIcon } from "lucide-react";
import type { Action } from "~/components/shared/action-bar/action-bar.component";

/** Opens a new session's page, to add it to her calendar. */
export const NEW_SESSION_ACTION: Action = {
  type: "link",
  label: "New session",
  icon: PlusIcon,
  style: "primary",
  iconOnlyOnPhone: true,
  link: { to: "/sessions/new" },
};
