import { useQuery } from "@tanstack/react-query";
import { SyncService } from "./sync.service";
import { SyncKeys } from "~/core/constants/query-keys.constant";

export const SyncQuery = {
  useStatus: () =>
    useQuery({
      queryKey: SyncKeys.status(),
      queryFn: () => SyncService.status(),
    }),
};
