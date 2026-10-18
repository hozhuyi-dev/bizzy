import type { ClientFields, ClientView } from "./clients.types";
import { invoke } from "~/core/lambda/lambda.client";

export const ClientsService = {
  list: () => invoke<Array<ClientView>>("clients.list"),
  get: (id: string) => invoke<ClientView>("clients.get", { id }),
  create: (fields: ClientFields) => invoke<ClientView>("clients.create", fields),
  /** A patch: only what is set changes. */
  update: (id: string, fields: ClientFields) => invoke<ClientView>("clients.update", { id, ...fields }),
  delete: (id: string) => invoke<null>("clients.delete", { id }),
  markContacted: (id: string, contacted: boolean) =>
    invoke<ClientView>("clients.markContacted", { id, contacted }),
};
