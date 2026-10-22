import { useQuery } from "@tanstack/react-query";
import { GoogleService } from "./google.service";
import type { AppStatusView } from "~/features/app/app.types";
import { GoogleKeys } from "~/core/constants/query-keys.constant";
import { AppQuery } from "~/features/app/app.query";

const google = (status: AppStatusView) => status.google;

export const GoogleQuery = {
  /** Null before the user connects. */
  useStatus: () => AppQuery.useStatus(google),

  useCalendars: (enabled: boolean) =>
    useQuery({
      queryKey: GoogleKeys.calendars(),
      queryFn: () => GoogleService.calendars(),
      enabled,
    }),
};
