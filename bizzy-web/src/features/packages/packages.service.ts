import type { Package, SavePackageInput } from "./packages.types";
import { invoke } from "~/core/lambda/lambda.client";

export const PackagesService = {
  list: (all: boolean) => invoke<Array<Package>>("packages.list", { all }),
  save: (input: SavePackageInput) => invoke<Package>("packages.save", input),
  delete: (id: string) => invoke<null>("packages.delete", { id }),
};
