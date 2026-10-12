import { Link } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { Button } from "~/components/ui/button";

/** Opens a new session's page, to add it to her calendar. */
export function NewSessionButton() {
  return (
    <Button size="sm" aria-label="New session" render={<Link to="/sessions/new" />} nativeButton={false}>
      <PlusIcon /> <span className="hidden sm:inline">New session</span>
    </Button>
  );
}
