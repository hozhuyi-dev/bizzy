import { useState } from "react";
import { PackageIcon } from "lucide-react";
import type { ClientView } from "../../clients.types";
import type { PackageTarget } from "~/features/packages/components/package-dialog/package-dialog.component";
import { PackagesQuery } from "~/features/packages/packages.query";
import { packagePayables } from "~/features/packages/packages.util";
import { PackageDialog } from "~/features/packages/components/package-dialog/package-dialog.component";
import { PaidMenu } from "~/features/payments/components/paid-menu/paid-menu.component";
import { ANOTHER_DAY } from "~/features/payments/paid-action.hook";
import { coveringDocuments, documentRoute, refLabel } from "~/features/documents/documents.util";
import { DataList, DataListItem, DataRow  } from "~/components/shared/list/data-list/data-list.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { ErrorState } from "~/components/shared/feedback/error-state/error-state.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { TextLink } from "~/components/shared/link/text-link/text-link.component";
import { Badge } from "~/components/ui/badge";
import { formatDate, formatHours } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";
import { QUIPS } from "~/core/constants/quips.constant";

/**
 * The client's packages, newest first: what each cost, what is left, and
 * its documents; Paid ▾ while one is owed. A row opens its dialog.
 */
export function ClientPackages({ client }: { client: ClientView }) {
  const packages = PackagesQuery.useList(true);
  const [editing, setEditing] = useState<PackageTarget>(null);
  if (!packages.data) {
    return packages.error ? <ErrorState error={packages.error} retry={packages.refetch} /> : <LoadingState />;
  }
  const own = packages.data
    .filter((pkg) => pkg.clientId === client.id)
    .sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt));
  if (own.length === 0) {
    return (
      <EmptyState quips={QUIPS.packages}>
        No packages. Write 10x85 after their name in the calendar, or use Add package.
      </EmptyState>
    );
  }
  return (
    <>
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
              onOpen={() => setEditing({ mode: "edit", pkg })}
              actions={
                pkg.can.pay.ok && (
                  <PaidMenu
                    payables={packagePayables(pkg).filter((p) => !p.paid)}
                    another={{ type: "button", label: ANOTHER_DAY, onClick: () => setEditing({ mode: "edit", pkg, at: "payment" }) }}
                  />
                )
              }
            />
          </DataListItem>
        ))}
      </DataList>
      <PackageDialog target={editing} onClose={() => setEditing(null)} />
    </>
  );
}
