import type { ContactDetails } from "./contacts.types";

/** The form works in strings; empty ones are sent as empty. */
export interface ContactValues {
  givenName: string;
  familyName: string;
  email: string;
  phone: string;
  street: string;
  postcode: string;
  city: string;
  region: string;
}

export function toContactValues(details: ContactDetails): ContactValues {
  return {
    givenName: details.givenName ?? "",
    familyName: details.familyName ?? "",
    email: details.email,
    phone: details.phone,
    street: details.address.street ?? "",
    postcode: details.address.postcode ?? "",
    city: details.address.city ?? "",
    region: details.address.region ?? "",
  };
}

/** "create" also sends the name; renaming happens in Google Contacts. */
export function toContactDetails(values: ContactValues, mode: "create" | "edit"): ContactDetails {
  return {
    ...(mode === "create" ? { givenName: values.givenName, familyName: values.familyName } : {}),
    email: values.email,
    phone: values.phone,
    address: { street: values.street, postcode: values.postcode, city: values.city, region: values.region },
  };
}
