import { useQuery } from "@tanstack/react-query";
import { PackagesService } from "./packages.service";
import { PackageKeys } from "~/core/constants/query-keys.constant";

export const PackagesQuery = {
  /** Open packages (credits left) unless `all`. */
  useList: (all = false) =>
    useQuery({
      queryKey: PackageKeys.list(all),
      queryFn: () => PackagesService.list(all),
    }),
};
