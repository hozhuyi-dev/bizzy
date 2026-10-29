import type { CoverView } from "./sessions.types";
import { ClientsQuery } from "~/features/clients/clients.query";
import { PackagesQuery } from "~/features/packages/packages.query";
import { formatDate, formatHours } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

/**
 * Says what would pay for a session, as the API's preview of it has it
 * (sessions.preview): the package credits, oldest first unless one is
 * chosen, then what they leave; or its fee, typed or the client's usual
 * one. Shared by the booking form and the Payment step, which ask for the
 * same preview.
 */
export function useDescribeCover() {
  const clientsById = ClientsQuery.useById();
  const packages = PackagesQuery.useList(true);

  return (cover: CoverView | undefined, clientId: string, feeTyped = false): string => {
    const name = clientsById.get(clientId)?.name;
    if (!name) return "Choose a client to see what pays for it.";
    if (!cover) return "Working out what pays for it…";
    const charged = `Charged as ${formatHours(cover.hours)}.`;
    const usual = cover.feeCents === undefined ? undefined : `${name}'s usual fee for ${formatHours(cover.feeHours)}: ${formatCents(cover.feeCents)}`;

    if (cover.by === "fee") {
      if (feeTyped) return `${charged} Its whole fee; blank for ${usual ?? `${name}'s usual fee, once set`}.`;
      return usual ? `${charged} ${usual}, unless another fee is entered.` : `${charged} ${name} has no usual fee: enter the fee.`;
    }

    const credits = cover.credits
      .map(({ packageId, hours }) => {
        const pkg = packages.data?.find((p) => p.id === packageId);
        // A package shared with them is named by whose it is.
        const holder = pkg ? (clientsById.get(pkg.clientId)?.name ?? name) : name;
        return pkg
          ? `${formatHours(hours)} of ${holder}'s package bought ${formatDate(pkg.purchasedAt)} (${formatHours(pkg.creditsLeft)} left)`
          : `${formatHours(hours)} of ${name}'s package credits`;
      })
      .join(", then ");
    switch (cover.kind) {
      case "credit":
        return `${charged} Paid by ${credits}.`;
      case "bought":
        return `${charged} Paid by ${credits ? `${credits}, then ` : ""}the package bought in this session.`;
      case "default":
        return credits
          ? `${charged} Paid by ${credits}, then ${usual}.`
          : `${charged} No package credits are left for it, so ${usual}.`;
      case "none":
        return credits
          ? `${charged} ${credits} leaves ${formatHours(cover.feeHours)}, and ${name} has no usual fee: pay it by its fee.`
          : `${charged} ${name} has no package credits for it and no usual fee: pay it by its fee.`;
    }
  };
}
