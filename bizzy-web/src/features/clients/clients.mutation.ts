import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClientsService } from "./clients.service";
import type { ClientFields } from "./clients.types";
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

  /** Puts a client away: out of lists and pickers, kept with all that is theirs. */
  useArchive: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (id: string) => ClientsService.archive(id),
      onSuccess: () => invalidateBilling(queryClient),
    });
  },

  useUnarchive: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (id: string) => ClientsService.unarchive(id),
      onSuccess: () => invalidateBilling(queryClient),
    });
  },

  /** Only a client added by mistake, with nothing of theirs, goes. */
  useDelete: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (id: string) => ClientsService.delete(id),
      onSuccess: () => invalidateBilling(queryClient),
    });
  },
};
