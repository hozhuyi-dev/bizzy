import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PackagesService } from "./packages.service";
import type { SavePackageInput } from "./packages.types";
import { invalidateBilling } from "~/core/utils/query.util";

// A refusal says why and offers its remedies (see remedies).
export const PackagesMutation = {
  useSave: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (input: SavePackageInput) => PackagesService.save(input),
      onSuccess: () => invalidateBilling(queryClient),
    });
  },

  useDelete: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (id: string) => PackagesService.delete(id),
      onSuccess: () => invalidateBilling(queryClient),
    });
  },

  useMakeStandalone: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (id: string) => PackagesService.makeStandalone(id),
      onSuccess: () => invalidateBilling(queryClient),
    });
  },
};
