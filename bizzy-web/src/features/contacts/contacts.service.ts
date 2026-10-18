import type { ContactDetails, ContactView } from "./contacts.types";
import { invoke } from "~/core/lambda/lambda.client";

export const ContactsService = {
  list: () => invoke<Array<ContactView>>("contacts.list"),
  get: (resourceName: string) => invoke<ContactView>("contacts.get", { resourceName }),
  create: (details: ContactDetails) => invoke<ContactView>("contacts.create", details),
  update: (resourceName: string, etag: string, details: ContactDetails) =>
    invoke<ContactView>("contacts.update", { resourceName, etag, details }),
};
