import { useQuery } from "@tanstack/react-query";
import { GoogleService } from "./google.service";
import { GoogleKeys } from "~/core/constants/query-keys.constant";

export const GoogleQuery = {
  useStatus: () =>
    useQuery({
      queryKey: GoogleKeys.status(),
      queryFn: () => GoogleService.status(),
    }),

  useCalendars: (enabled: boolean) =>
    useQuery({
      queryKey: GoogleKeys.calendars(),
      queryFn: () => GoogleService.calendars(),
      enabled,
    }),
};
