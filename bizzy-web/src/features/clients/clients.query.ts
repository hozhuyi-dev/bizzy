import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClientsService } from "./clients.service";
import type { ClientView } from "./clients.types";
import { ClientKeys } from "~/core/constants/query-keys.constant";

export const ClientsQuery = {
  useList: () =>
    useQuery({
      queryKey: ClientKeys.list(),
      queryFn: () => ClientsService.list(),
    }),

  /** Clients by id, for showing names next to sessions and documents. */
  useById: (): ReadonlyMap<string, ClientView> => {
    const { data } = ClientsQuery.useList();
    return useMemo(() => new Map((data ?? []).map((client) => [client.id, client])), [data]);
  },
};
