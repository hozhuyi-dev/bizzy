import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClientsService } from "./clients.service";
import type { SaveClientInput } from "./clients.types";
import { ClientKeys } from "~/core/constants/query-keys.constant";
import { invalidateBilling } from "~/core/utils/query.util";

export const ClientsMutation = {
  /** Saving can match unmatched sessions and follow-ups, and reprice sessions. */
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
