import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ContactsService } from "./contacts.service";
import type { Contact, ContactDetails } from "./contacts.types";
import { ClientKeys, ContactKeys } from "~/core/constants/query-keys.constant";

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
