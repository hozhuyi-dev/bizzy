import { toast } from "sonner";
import { PackagesMutation } from "./packages.mutation";
import type { Package, SavePackageInput } from "./packages.types";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

/**
 * Saves a package from its form. The API decides it: saved, or refused with
 * why and what would let it through (shown with its remedies), which
 * rejects so the form stays as she left it.
 */
export function usePackageSave(pkg: Package | undefined, onSaved: () => void) {
  const save = PackagesMutation.useSave();

  const submit = async (input: SavePackageInput) => {
    try {
      await save.mutateAsync(input);
    } catch (error) {
      toastRefusal(error);
      throw error;
    }
    toast.success(pkg ? "Package updated" : "Package added");
    onSaved();
  };

  return { submit, saving: save.isPending };
}
