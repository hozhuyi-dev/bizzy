import { useQuery } from "@tanstack/react-query";
import { ClientsService } from "./clients.service";
import { ClientKeys } from "~/core/keys.query";

export const ClientsQuery = {
  useList: () =>
    useQuery({
      queryKey: ClientKeys.list(),
      queryFn: () => ClientsService.list(),
    }),
};
