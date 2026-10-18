import { Link } from "@tanstack/react-router";
import { GoogleQuery } from "../../google.query";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";

/**
 * Asks her to connect Google, to reconnect it, or to choose its calendar,
 * where the app can't work without it. Shows nothing while connected.
 */
export function GoogleNotice() {
  const status = GoogleQuery.useStatus();
  const unchosen = Boolean(status.data && !status.data.problem && !status.data.calendarId);
  if (!status.isSuccess || (status.data && !status.data.problem && !unchosen)) return null;

  const message = unchosen
    ? "Choose the calendar you book sessions in, so bizzy can sync it."
    : (status.data?.problem
      ?? "Connect your Google account so bizzy can read your calendar and link clients to your contacts.");
  const action = unchosen ? "Choose in Settings" : status.data ? "Reconnect in Settings" : "Connect in Settings";

  return (
    <Card size="sm" className="mb-4">
      <CardContent className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">{message}</p>
        <Button size="sm" render={<Link to="/settings" />} nativeButton={false}>
          {action}
        </Button>
      </CardContent>
    </Card>
  );
}
