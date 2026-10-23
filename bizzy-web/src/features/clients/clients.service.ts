import type { ClientFields, ClientView } from "./clients.types";
import { invoke } from "~/core/lambda/lambda.client";

export const ClientsService = {
  list: () => invoke<Array<ClientView>>("clients.list"),
  get: (id: string) => invoke<ClientView>("clients.get", { id }),
  create: (fields: ClientFields) => invoke<ClientView>("clients.create", fields),
  /** A patch: only what is set changes. */
  update: (id: string, fields: ClientFields) => invoke<ClientView>("clients.update", { id, ...fields }),
  /** Puts them away, with all that is theirs. */
  archive: (id: string) => invoke<ClientView>("clients.archive", { id }),
  unarchive: (id: string) => invoke<ClientView>("clients.unarchive", { id }),
  /** Only one added by mistake, with nothing of theirs. */
  delete: (id: string) => invoke<null>("clients.delete", { id }),
};
