import { extraAliases } from "./clients.util";
import type { Client, SaveClientInput } from "./clients.types";
import { centsToInput, parseCents } from "~/core/utils/money.util";

export interface ClientFormValues {
  name: string;
  /** Comma-separated; easier to type on a phone than a tag input. */
  aliases: string;
  defaultFee: string;
  homeVisits: boolean;
}

/** An existing client, or a new one with a name to start from. */
export function toClientValues(client: Client | undefined, initialName: string | undefined): ClientFormValues {
  return {
    name: client?.name ?? initialName ?? "",
    aliases: client ? extraAliases(client).join(", ") : "",
    defaultFee: centsToInput(client?.defaultFeeCents),
    homeVisits: client?.homeVisits ?? false,
  };
}

export function toClientInput(
  values: ClientFormValues,
  id: string | undefined,
  resourceName: string | undefined,
): SaveClientInput {
  const fee = values.defaultFee.trim();
  return {
    ...(id ? { id } : {}),
    name: values.name,
    ...(resourceName ? { contact: { resourceName } } : {}),
    aliases: values.aliases.split(",").map((alias) => alias.trim()).filter(Boolean),
    ...(fee ? { defaultFeeCents: parseCents(fee) ?? 0 } : {}),
    ...(values.homeVisits ? { homeVisits: true } : {}),
  };
}
