import { useMemo } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { ClientsService } from "./clients.service";
import type { ClientView } from "./clients.types";
import { ClientKeys } from "~/core/constants/query-keys.constant";

const list = () => queryOptions({ queryKey: ClientKeys.list(), queryFn: () => ClientsService.list() });

export const ClientsQuery = {
  /** For a route's loader (see pageData). */
  list,
  useList: () => useQuery(list()),

  /** Clients by id, for showing names next to sessions and documents. */
  useById: (): ReadonlyMap<string, ClientView> => {
    const { data } = ClientsQuery.useList();
    return useMemo(() => new Map((data ?? []).map((client) => [client.id, client])), [data]);
  },
};
