import type { GoogleCalendar, GoogleConnection } from "./google.types";
import { invoke } from "~/core/lambda/lambda.client";

export const GoogleService = {
  /** Null before she connects. */
  status: () => invoke<GoogleConnection | null>("google.status"),
  connect: (code: string, redirectUri: string) =>
    invoke<GoogleConnection>("google.connect", { code, redirectUri }),
  disconnect: () => invoke<null>("google.disconnect"),
  calendars: () => invoke<Array<GoogleCalendar>>("google.calendars"),
  setCalendar: (id: string) => invoke<GoogleConnection>("google.setCalendar", { id }),
};
