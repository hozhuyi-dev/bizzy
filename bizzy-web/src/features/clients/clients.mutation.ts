import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClientsService } from "./clients.service";
import type { SaveClientInput } from "./clients.types";
import { ClientKeys } from "~/core/keys.query";

export const ClientsMutation = {
  useSave: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (input: SaveClientInput) => ClientsService.save(input),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ClientKeys.all }),
    });
  },
};
