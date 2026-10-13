import type { Contact, ContactDetails } from "./contacts.types";
import { invoke } from "~/core/lambda/lambda.client";

export const ContactsService = {
  list: () => invoke<Array<Contact>>("contacts.list"),
  get: (resourceName: string) => invoke<Contact>("contacts.get", { resourceName }),
  create: (details: ContactDetails) => invoke<Contact>("contacts.create", details),
  update: (resourceName: string, etag: string, details: ContactDetails) =>
    invoke<Contact>("contacts.update", { resourceName, etag, details }),
};
