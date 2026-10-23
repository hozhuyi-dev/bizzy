import { useLocation } from "@tanstack/react-router";
import { CircleAlertIcon, ListChecksIcon, SettingsIcon } from "lucide-react";
import { SettingsQuery } from "../../settings.query";
import { setupMessage } from "../../settings.util";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import { Banner } from "~/components/shared/layout/banner/banner.component";
import { GoogleQuery } from "~/features/google/google.query";

/**
 * What is left to set up, on every page, as one banner: Google to connect,
 * reconnect or choose a calendar for, and the business details invoices and
 * receipts print (as the API says they are missing). In attention colours
 * when Google reports a problem. Shows nothing once all is set, and nothing
 * of what hasn't loaded yet.
 */
export function SetupNotice() {
  const google = GoogleQuery.useStatus();
  const gaps = SettingsQuery.useGaps();
  const onSettings = useLocation({ select: (location) => location.pathname === "/settings" });

  const notice = setupMessage(
    google.isSuccess ? { connection: google.data } : undefined,
    gaps.isSuccess ? gaps.data.missing : [],
  );
  if (!notice) return null;

  const actions: Array<Action> = onSettings
    ? []
    : [{ type: "link", label: notice.problem ? "Reconnect in Settings" : "Open Settings", icon: SettingsIcon, style: "primary", link: { to: "/settings" } }];

  return (
    <Banner
      tone={notice.problem ? "attention" : "plain"}
      icon={notice.problem ? CircleAlertIcon : ListChecksIcon}
      role={notice.problem ? "alert" : undefined}
      actions={actions}
    >
      {notice.text}
    </Banner>
  );
}
