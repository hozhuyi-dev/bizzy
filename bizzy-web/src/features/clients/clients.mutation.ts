import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClientsService } from "./clients.service";
import type { Client, SaveClientInput } from "./clients.types";
import { ClientKeys } from "~/core/keys.query";
import { invalidateBilling } from "~/core/utils/query.util";

export const ClientsMutation = {
  /** Saving can match unmatched sessions and reprice others. */
  useSave: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (input: SaveClientInput) => ClientsService.save(input),
      onSuccess: () => invalidateBilling(queryClient),
    });
  },

  useMarkContacted: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ id, contacted }: { id: string; contacted: boolean }) =>
        ClientsService.markContacted(id, contacted),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ClientKeys.all }),
    });
  },
};

/** The editable part of a client, to save it back with a change. */
export function profileOf(client: Client): SaveClientInput {
  return {
    id: client.id,
    name: client.name,
    aliases: client.aliases,
    ...(client.email ? { email: client.email } : {}),
    ...(client.phone ? { phone: client.phone } : {}),
    ...(client.address ? { address: client.address } : {}),
    ...(client.postcode ? { postcode: client.postcode } : {}),
    ...(client.defaultFeeCents !== undefined ? { defaultFeeCents: client.defaultFeeCents } : {}),
    ...(client.homeVisits ? { homeVisits: true } : {}),
  };
}
