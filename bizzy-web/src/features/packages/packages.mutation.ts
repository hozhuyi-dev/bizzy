import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PackagesService } from "./packages.service";
import type { PackageFields } from "./packages.types";
import { invalidateBilling } from "~/core/utils/query.util";

// A refusal says why and offers its remedies (see remedies).
export const PackagesMutation = {
  useCreate: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (fields: PackageFields) => PackagesService.create(fields),
      onSuccess: () => invalidateBilling(queryClient),
    });
  },

  /** A patch: only what is set changes. */
  useUpdate: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ id, fields }: { id: string; fields: PackageFields }) => PackagesService.update(id, fields),
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
