import { Link } from "@tanstack/react-router";
import { GoogleQuery } from "../../google.query";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";

/**
 * Asks her to connect Google, or to reconnect it, where the app can't work
 * without it. Shows nothing while connected.
 */
export function GoogleNotice() {
  const status = GoogleQuery.useStatus();
  if (!status.isSuccess || (status.data && !status.data.problem)) return null;

  const message = status.data?.problem
    ?? "Connect your Google account so bizzy can read your calendar and link clients to your contacts.";

  return (
    <Card size="sm" className="mb-4">
      <CardContent className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">{message}</p>
        <Button size="sm" render={<Link to="/settings" />} nativeButton={false}>
          {status.data ? "Reconnect in Settings" : "Connect in Settings"}
        </Button>
      </CardContent>
    </Card>
  );
}
