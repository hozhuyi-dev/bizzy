import type { Package, PackageOptions, SavePackageInput } from "./packages.types";
import type { Impact } from "~/features/billing/billing.types";
import { invoke } from "~/core/lambda/lambda.client";

export const PackagesService = {
  list: (all: boolean) => invoke<Array<Package>>("packages.list", { all }),
  /** What saving (or, with `delete`, deleting) a package would bring on. */
  impact: (input: Partial<SavePackageInput> & { id?: string; delete?: boolean }, options: PackageOptions = {}) =>
    invoke<Impact>("packages.impact", { ...input, ...options }),
  save: (input: SavePackageInput, options: PackageOptions = {}) =>
    invoke<Package>("packages.save", { ...input, ...options }),
  delete: (id: string, options: PackageOptions = {}) => invoke<null>("packages.delete", { id, ...options }),
  /** Keeps a package the calendar no longer buys as one of its own. */
  makeStandalone: (id: string) => invoke<Package>("packages.makeStandalone", { id }),
};
