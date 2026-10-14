import type { Client, SaveClientInput } from "./clients.types";
import type { Impact } from "~/features/billing/billing.types";
import { invoke } from "~/core/lambda/lambda.client";

export const ClientsService = {
  list: () => invoke<Array<Client>>("clients.list"),
  /** What saving the client would bring on: sessions its fees reprice, or its names match or unmatch. */
  impact: (input: SaveClientInput) => invoke<Impact>("clients.impact", input),
  /** confirm: she saw what the impact said saving brings on. */
  save: (input: SaveClientInput, confirm = false) => invoke<Client>("clients.save", { ...input, confirm }),
  markContacted: (id: string, contacted: boolean) =>
    invoke<null>("clients.markContacted", { id, contacted }),
};
