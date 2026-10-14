import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PackagesService } from "./packages.service";
import type { PackageOptions, SavePackageInput } from "./packages.types";
import { invalidateBilling } from "~/core/utils/query.util";

// Saving and deleting go through their preview: see usePackageSave.
export const PackagesMutation = {
  useSave: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ input, options }: { input: SavePackageInput; options?: PackageOptions }) =>
        PackagesService.save(input, options),
      onSuccess: () => invalidateBilling(queryClient),
    });
  },

  useDelete: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ id, options }: { id: string; options?: PackageOptions }) => PackagesService.delete(id, options),
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
