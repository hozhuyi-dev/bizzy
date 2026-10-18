import { CalendarIcon, CircleAlertIcon, SettingsIcon } from "lucide-react";
import { GoogleQuery } from "../../google.query";
import { Banner } from "~/components/shared/banner/banner.component";

/**
 * Asks her to connect Google, to reconnect it, or to choose its calendar,
 * where the app can't work without it: a page banner, in attention colours
 * when Google reports a problem. Shows nothing while connected.
 */
export function GoogleNotice() {
  const status = GoogleQuery.useStatus();
  const unchosen = Boolean(status.data && !status.data.problem && !status.data.calendarId);
  if (!status.isSuccess || (status.data && !status.data.problem && !unchosen)) return null;

  const problem = status.data?.problem;
  const message = unchosen
    ? "Choose the calendar you book sessions in, so bizzy can sync it."
    : (problem ?? "Connect your Google account so bizzy can read your calendar and link clients to your contacts.");
  const label = unchosen ? "Choose in Settings" : status.data ? "Reconnect in Settings" : "Connect in Settings";

  return (
    <Banner
      tone={problem ? "attention" : "plain"}
      icon={problem ? CircleAlertIcon : CalendarIcon}
      actions={[{ type: "link", label, icon: SettingsIcon, style: "primary", link: { to: "/settings" } }]}
    >
      {message}
    </Banner>
  );
}
