import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackagesService } from "./packages.service";
import type { SavePackageInput } from "./packages.types";
import { PackageKeys } from "~/core/keys.query";
import { invalidateBilling } from "~/core/utils/query.util";

export const PackagesQuery = {
  /** Open packages (credits left) unless `all`. */
  useList: (all = false) =>
    useQuery({
      queryKey: PackageKeys.list(all),
      queryFn: () => PackagesService.list(all),
    }),
};

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
};
