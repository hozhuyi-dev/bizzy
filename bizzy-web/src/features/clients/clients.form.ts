import { extraAliases } from "./clients.util";
import type { Client, FeeRate, SaveClientInput } from "./clients.types";
import { centsToInput, parseCents } from "~/core/utils/money.util";

/** One fee as typed; the first row has no date (it applies from the start). */
export interface FeeRateValues {
  from: string;
  amount: string;
}

export interface ClientFormValues {
  name: string;
  /** Comma-separated; easier to type on a phone than a tag input. */
  aliases: string;
  fees: Array<FeeRateValues>;
  homeVisits: boolean;
}

/** An existing client, or a new one with a name to start from. */
export function toClientValues(client: Client | undefined, initialName: string | undefined): ClientFormValues {
  return {
    name: client?.name ?? initialName ?? "",
    aliases: client ? extraAliases(client).join(", ") : "",
    fees: (client?.feeRates ?? []).map((rate) => ({ from: rate.from ?? "", amount: centsToInput(rate.cents) })),
    homeVisits: client?.homeVisits ?? false,
  };
}

/** The fees as the API takes them: the first row applies from the start, whatever date it had. */
export function toFeeRates(fees: ReadonlyArray<FeeRateValues>): Array<FeeRate> {
  return fees.map((fee, i) => ({
    ...(i > 0 ? { from: fee.from } : {}),
    cents: parseCents(fee.amount) ?? 0,
  }));
}

/** Whether the fees differ from the client's, ignoring order. */
export function feesChanged(client: Client, rates: ReadonlyArray<FeeRate>): boolean {
  const key = (list: ReadonlyArray<FeeRate>) =>
    list
      .map((rate) => `${rate.from ?? ""}=${rate.cents}`)
      .sort()
      .join(",");
  return key(client.feeRates ?? []) !== key(rates);
}

export function feeAmountError(amount: string): string | undefined {
  return parseCents(amount) === null ? "Enter an amount like 95 or 95.50" : undefined;
}

/** Why row i can't start on from, or undefined. The first row has no start. */
export function feeStartError(fees: ReadonlyArray<FeeRateValues>, i: number, from: string): string | undefined {
  if (i === 0) return undefined;
  if (!from) return "Choose the day it starts";
  if (fees.some((other, j) => j > 0 && j !== i && other.from === from)) return "Another fee starts that day";
  return undefined;
}

export function toClientInput(
  values: ClientFormValues,
  id: string | undefined,
  resourceName: string | undefined,
): SaveClientInput {
  return {
    ...(id ? { id } : {}),
    name: values.name,
    ...(resourceName ? { contact: { resourceName } } : {}),
    aliases: values.aliases.split(",").map((alias) => alias.trim()).filter(Boolean),
    feeRates: toFeeRates(values.fees),
    ...(values.homeVisits ? { homeVisits: true } : {}),
  };
}
