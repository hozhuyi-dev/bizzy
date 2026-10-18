import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClientsService } from "./clients.service";
import type { ClientFields } from "./clients.types";
import { ClientKeys } from "~/core/constants/query-keys.constant";
import { invalidateBilling } from "~/core/utils/query.util";

export const ClientsMutation = {
  /** A new fee reprices sessions; a new calendar name can let a waiting edit apply. */
  useCreate: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (fields: ClientFields) => ClientsService.create(fields),
      onSuccess: () => invalidateBilling(queryClient),
    });
  },

  /** A patch: only what is set changes. */
  useUpdate: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ id, fields }: { id: string; fields: ClientFields }) => ClientsService.update(id, fields),
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
