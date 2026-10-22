import type { GoogleCalendar, GoogleConnectionView, SetCalendarRequest } from "./google.types";
import { invoke } from "~/core/lambda/lambda.client";

export const GoogleService = {
  connect: (code: string, redirectUri: string) =>
    invoke<GoogleConnectionView>("google.connect", { code, redirectUri }),
  disconnect: () => invoke<null>("google.disconnect"),
  calendars: () => invoke<Array<GoogleCalendar>>("google.calendars"),
  setCalendar: (request: SetCalendarRequest) => invoke<GoogleConnectionView>("google.setCalendar", request),
};
