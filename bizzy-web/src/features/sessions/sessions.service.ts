import type { Session } from "./sessions.types";
import { invoke } from "~/core/lambda/lambda.client";

export const SessionsService = {
  listOpen: () => invoke<Array<Session>>("sessions.listOpen"),
  list: (from: string, to: string) => invoke<Array<Session>>("sessions.list", { from, to }),
  setIgnored: (eventId: string, ignored: boolean) =>
    invoke<null>("sessions.setIgnored", { eventId, ignored }),
};
