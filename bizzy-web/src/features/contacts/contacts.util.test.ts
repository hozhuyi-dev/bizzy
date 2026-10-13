import { contactUrl, searchContacts } from "./contacts.util";
import type { Contact } from "./contacts.types";

const contact = (displayName: string, extra: Partial<Contact> = {}): Contact => ({
  resourceName: `people/${displayName}`,
  etag: "e",
  displayName,
  address: {},
  ...extra,
});

const all = [
  contact("Mary Jane Tan"),
  contact("Jane Smith", { email: "jane@example.com", phone: "012-345 6789" }),
  contact("Bob Lee", { nicknames: ["Bobby"] }),
];

describe("searchContacts", () => {
  test("matches every word, names starting with it first", () => {
    expect(searchContacts(all, "jane").map((c) => c.displayName)).toEqual(["Jane Smith", "Mary Jane Tan"]);
    expect(searchContacts(all, "jane tan").map((c) => c.displayName)).toEqual(["Mary Jane Tan"]);
  });

  test("matches nicknames, emails and phone digits", () => {
    expect(searchContacts(all, "bobby").map((c) => c.displayName)).toEqual(["Bob Lee"]);
    expect(searchContacts(all, "example.com").map((c) => c.displayName)).toEqual(["Jane Smith"]);
    expect(searchContacts(all, "3456789").map((c) => c.displayName)).toEqual(["Jane Smith"]);
  });

  test("returns everyone for an empty query", () => {
    expect(searchContacts(all, "  ")).toHaveLength(3);
  });
});

test("contactUrl opens the contact in Google Contacts", () => {
  expect(contactUrl("people/c123")).toBe("https://contacts.google.com/person/c123");
});
