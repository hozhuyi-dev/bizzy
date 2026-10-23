import { extraAliases } from "./clients.util";
import type { ClientFields, ClientView } from "./clients.types";
import { centsToInput, parseCents } from "~/core/utils/money.util";

export interface ClientFormValues {
  name: string;
  /** Comma-separated; easier to type on a phone than a tag input. */
  aliases: string;
  /** The usual hourly fee; blank for none. */
  fee: string;
  homeVisits: boolean;
  idNo: string;
}

/** An existing client, or a new one with a name to start from. */
export function toClientValues(client: ClientView | undefined, initialName: string | undefined): ClientFormValues {
  return {
    name: client?.name ?? initialName ?? "",
    aliases: client ? extraAliases(client).join(", ") : "",
    fee: centsToInput(client?.feeCents),
    homeVisits: client?.homeVisits ?? false,
    idNo: client?.idNo ?? "",
  };
}

/**
 * What to send for a client: all of it for a new one, and only what changed
 * on `client` for an edit, since an update is a patch. `resourceName` is the
 * contact chosen; none unlinks the one the client had.
 */
export function toClientFields(
  values: ClientFormValues,
  client: ClientView | undefined,
  resourceName: string | undefined,
): ClientFields {
  const fields: ClientFields = {};
  const aliases = values.aliases.split(",").map((alias) => alias.trim()).filter(Boolean);
  const feeCents = parseCents(values.fee) ?? undefined;
  if (!client || values.name !== client.name) fields.name = values.name;
  if (!client || aliases.join(",") !== extraAliases(client).join(",")) fields.aliases = aliases;
  if (feeCents !== client?.feeCents) fields.fee = feeCents === undefined ? {} : { cents: feeCents };
  if (!client || values.homeVisits !== client.homeVisits) fields.homeVisits = values.homeVisits;
  if (values.idNo.trim() !== (client?.idNo ?? "")) fields.idNo = values.idNo.trim();
  if ((resourceName ?? "") !== (client?.contact?.resourceName ?? "")) fields.contact = { resourceName: resourceName ?? "" };
  return fields;
}
