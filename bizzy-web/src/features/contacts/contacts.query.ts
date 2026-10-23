import { useQuery } from "@tanstack/react-query";
import { ContactsService } from "./contacts.service";
import { ContactKeys } from "~/core/constants/query-keys.constant";

export const ContactsQuery = {
  /** All her contacts, searched in the browser. */
  useList: () =>
    useQuery({
      queryKey: ContactKeys.list(),
      queryFn: () => ContactsService.list(),
      staleTime: 5 * 60_000,
    }),

  /** A fresh read, to edit against the latest version. */
  useDetail: (resourceName: string) =>
    useQuery({
      queryKey: ContactKeys.detail(resourceName),
      queryFn: () => ContactsService.get(resourceName),
      staleTime: 0,
    }),
};
