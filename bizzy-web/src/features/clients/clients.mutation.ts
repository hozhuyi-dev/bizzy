import { useMutation } from "@tanstack/react-query";
import { ClientsService } from "./clients.service";
import type { ClientFields } from "./clients.types";

// What each changes is read again as the API says (refreshChanged).
export const ClientsMutation = {
  /** A new fee reprices sessions; a new calendar name can let a waiting edit apply. */
  useCreate: () => useMutation({ mutationFn: (fields: ClientFields) => ClientsService.create(fields) }),

  /** A patch: only what is set changes. */
  useUpdate: () =>
    useMutation({
      mutationFn: ({ id, fields }: { id: string; fields: ClientFields }) => ClientsService.update(id, fields),
    }),

  /** Puts a client away: out of lists and pickers, kept with all that is theirs. */
  useArchive: () => useMutation({ mutationFn: (id: string) => ClientsService.archive(id) }),

  useUnarchive: () => useMutation({ mutationFn: (id: string) => ClientsService.unarchive(id) }),

  /** Only a client added by mistake, with nothing of theirs, goes. */
  useDelete: () => useMutation({ mutationFn: (id: string) => ClientsService.delete(id) }),
};
