import { useQuery } from "@tanstack/react-query";
import { SessionsService } from "./sessions.service";
import { SessionKeys } from "~/core/keys.query";
import { monthRange } from "~/core/utils/date.util";

export const SessionsQuery = {
  useOpen: () =>
    useQuery({
      queryKey: SessionKeys.open(),
      queryFn: () => SessionsService.listOpen(),
    }),

  /** One local month, "2026-10". */
  useMonth: (month: string) => {
    const { from, to } = monthRange(month);
    return useQuery({
      queryKey: SessionKeys.range(from, to),
      queryFn: () => SessionsService.list(from, to),
    });
  },
};
