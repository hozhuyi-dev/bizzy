import type { GoogleCalendar, GoogleConnectionView } from "./google.types";
import { invoke } from "~/core/lambda/lambda.client";

export const GoogleService = {
  /** Null before she connects. */
  status: () => invoke<GoogleConnectionView | null>("google.status"),
  connect: (code: string, redirectUri: string) =>
    invoke<GoogleConnectionView>("google.connect", { code, redirectUri }),
  disconnect: () => invoke<null>("google.disconnect"),
  calendars: () => invoke<Array<GoogleCalendar>>("google.calendars"),
  setCalendar: (id: string) => invoke<GoogleConnectionView>("google.setCalendar", { id }),
};
