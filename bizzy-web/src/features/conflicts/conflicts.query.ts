import { useQuery } from "@tanstack/react-query";
import { ConflictsService } from "./conflicts.service";
import { ConflictKeys } from "~/core/constants/query-keys.constant";

export const ConflictsQuery = {
  /** The edits waiting on one session's event. */
  useByTarget: (targetId: string) =>
    useQuery({
      queryKey: ConflictKeys.target(targetId),
      queryFn: () => ConflictsService.listByTarget(targetId),
    }),
};
