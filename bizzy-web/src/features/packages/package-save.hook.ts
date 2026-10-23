import { toast } from "sonner";
import { PackagesMutation } from "./packages.mutation";
import type { PackageFields, PackageView } from "./packages.types";

/**
 * Saves a package from its form: a new one, or what changed on `pkg`. The
 * API decides it: saved, or refused with why and what would let it
 * through, which rejects so the form stays as the user left it.
 */
/** `onSaved` gets what the toast says; `quiet` leaves the toast to it, to say with more. */
export function usePackageSave(pkg: PackageView | undefined, onSaved: (done: string) => void, quiet = false) {
  const create = PackagesMutation.useCreate();
  const update = PackagesMutation.useUpdate();

  const submit = async (fields: PackageFields) => {
    if (pkg) await update.mutateAsync({ id: pkg.id, fields });
    else await create.mutateAsync(fields);
    const done = pkg ? "Package updated" : "Package added";
    if (!quiet) toast.success(done);
    onSaved(done);
  };

  return { submit, saving: create.isPending || update.isPending };
}
