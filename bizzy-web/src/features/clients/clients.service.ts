import type { Client, SaveClientInput } from "./clients.types";
import { invoke } from "~/core/lambda/lambda.client";

export const ClientsService = {
  list: () => invoke<Array<Client>>("clients.list"),
  save: (input: SaveClientInput) => invoke<Client>("clients.save", input),
  markContacted: (id: string, contacted: boolean) =>
    invoke<null>("clients.markContacted", { id, contacted }),
};
