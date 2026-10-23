import { PackageIcon } from "lucide-react";
import type { ClientView } from "../../clients.types";
import { PackagesQuery } from "~/features/packages/packages.query";
import { coveringDocuments, documentRoute, refLabel } from "~/features/documents/documents.util";
import { DataList, DataListItem, DataRow  } from "~/components/shared/list/data-list/data-list.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { ErrorState } from "~/components/shared/feedback/error-state/error-state.component";
import { TextLink } from "~/components/shared/link/text-link/text-link.component";
import { Badge } from "~/components/ui/badge";
import { formatDate, formatHours } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

/** The client's packages, newest first: what each cost, what is left, and its documents. */
export function ClientPackages({ client }: { client: ClientView }) {
  const packages = PackagesQuery.useList(true);
  if (!packages.data) {
    return packages.error ? <ErrorState error={packages.error} retry={packages.refetch} /> : <LoadingState />;
  }
  const own = packages.data
    .filter((pkg) => pkg.clientId === client.id)
    .sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));
  if (own.length === 0) {
    return <p className="text-sm text-muted-foreground">No packages. Write 10x85 after their name in the calendar, or use Add package.</p>;
  }
  return (
    <DataList label="Packages">
      {own.map((pkg) => (
        <DataListItem key={pkg.id}>
          <DataRow
            title={
              <>
                <PackageIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="font-medium">
                  {formatHours(pkg.hours)} for {formatCents(pkg.priceCents)}
                </span>
                {pkg.creditsLeft > 0 ? (
                  <Badge variant="info">{formatHours(pkg.creditsLeft)} left</Badge>
                ) : (
                  <Badge variant="neutral">Used</Badge>
                )}
                {pkg.owedCents > 0 && <Badge variant="attention">Unpaid</Badge>}
              </>
            }
            meta={
              <span className="flex items-center gap-3">
                <span>Bought {formatDate(pkg.purchasedAt)}</span>
                {coveringDocuments(pkg).map(({ type, ref, issued }) => (
                  <TextLink key={type} to={documentRoute(type)} params={{ id: ref.id }} className="font-normal">
                    {refLabel(type, ref, issued)}
                  </TextLink>
                ))}
              </span>
            }
            detail={pkg.note}
          />
        </DataListItem>
      ))}
    </DataList>
  );
}
