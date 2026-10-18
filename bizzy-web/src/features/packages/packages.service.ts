import type { PackageFields, PackageView } from "./packages.types";
import { invoke } from "~/core/lambda/lambda.client";

export const PackagesService = {
  /** Packages with credits left or still owed, or every one with `all`. */
  list: (all: boolean) => invoke<Array<PackageView>>("packages.list", { all }),
  create: (fields: PackageFields) => invoke<PackageView>("packages.create", fields),
  /** A patch: only what is set changes. */
  update: (id: string, fields: PackageFields) => invoke<PackageView>("packages.update", { id, ...fields }),
  delete: (id: string) => invoke<null>("packages.delete", { id }),
  /** Keeps a package bought in a session as one on its own: the session's title no longer buys it. */
  makeStandalone: (id: string) => invoke<PackageView>("packages.makeStandalone", { id }),
};
