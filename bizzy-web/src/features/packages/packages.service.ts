import type { Package, SavePackageInput } from "./packages.types";
import { invoke } from "~/core/lambda/lambda.client";

export const PackagesService = {
  list: (all: boolean) => invoke<Array<Package>>("packages.list", { all }),
  save: (input: SavePackageInput) => invoke<Package | null>("packages.save", input),
  delete: (id: string) => invoke<null>("packages.delete", { id }),
  /** Keeps a package bought in a session as one of its own: the session's title no longer buys it. */
  makeStandalone: (id: string) => invoke<Package>("packages.makeStandalone", { id }),
};
