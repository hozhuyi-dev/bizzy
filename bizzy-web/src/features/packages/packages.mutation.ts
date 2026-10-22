import { useMutation } from "@tanstack/react-query";
import { PackagesService } from "./packages.service";
import type { PackageFields } from "./packages.types";

// A refusal says why and offers its remedies (see remedies); what each
// changes is read again as the API says (refreshChanged).
export const PackagesMutation = {
  useCreate: () => useMutation({ mutationFn: (fields: PackageFields) => PackagesService.create(fields) }),

  /** A patch: only what is set changes. */
  useUpdate: () =>
    useMutation({
      mutationFn: ({ id, fields }: { id: string; fields: PackageFields }) => PackagesService.update(id, fields),
    }),

  useDelete: () => useMutation({ mutationFn: (id: string) => PackagesService.delete(id) }),

  useMakeStandalone: () => useMutation({ mutationFn: (id: string) => PackagesService.makeStandalone(id) }),
};
