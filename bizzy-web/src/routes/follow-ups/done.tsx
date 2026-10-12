import { createFileRoute } from "@tanstack/react-router";
import { FollowUpsPage } from "~/features/follow-ups/follow-ups-page.component";

export const Route = createFileRoute("/follow-ups/done")({
  component: () => <FollowUpsPage view="done" />,
});
