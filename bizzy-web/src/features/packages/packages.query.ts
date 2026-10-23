import { queryOptions, useQuery } from "@tanstack/react-query";
import { PackagesService } from "./packages.service";
import { PackageKeys } from "~/core/constants/query-keys.constant";

const list = (all = false) => queryOptions({ queryKey: PackageKeys.list(all), queryFn: () => PackagesService.list(all) });

export const PackagesQuery = {
  /** For a route's loader (see pageData). */
  list,
  /** Open packages (credits left) unless `all`. */
  useList: (all = false) => useQuery(list(all)),
};
