import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Contact, ContactDetails } from "./contacts.types";
import { invoke } from "~/core/lambda/lambda.client";
import { ClientKeys, ContactKeys } from "~/core/keys.query";

export const ContactsService = {
  list: () => invoke<Array<Contact>>("contacts.list"),
  get: (resourceName: string) => invoke<Contact>("contacts.get", { resourceName }),
  create: (details: ContactDetails) => invoke<Contact>("contacts.create", details),
  update: (resourceName: string, etag: string, details: ContactDetails) =>
    invoke<Contact>("contacts.update", { resourceName, etag, details }),
};

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

export const ContactsMutation = {
  useCreate: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (details: ContactDetails) => ContactsService.create(details),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ContactKeys.list() }),
    });
  },

  /** Writes to Google; the API refreshes the linked clients' copies. */
  useUpdate: () => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ contact, details }: { contact: Contact; details: ContactDetails }) =>
        ContactsService.update(contact.resourceName, contact.etag, details),
      onSettled: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: ContactKeys.all }),
          queryClient.invalidateQueries({ queryKey: ClientKeys.all }),
        ]),
    });
  },
};
