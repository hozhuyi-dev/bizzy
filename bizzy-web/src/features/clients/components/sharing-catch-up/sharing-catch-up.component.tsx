import { toast } from "sonner";
import { ClientsQuery } from "../../clients.query";
import type { ClientView } from "../../clients.types";
import type { PackageView } from "~/features/packages/packages.types";
import { PackagesMutation } from "~/features/packages/packages.mutation";
import { PackagesQuery } from "~/features/packages/packages.query";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";
import { Button } from "~/components/ui/button";
import { FieldDescription } from "~/components/ui/field";
import { formatDate, formatHours } from "~/core/utils/date.util";

interface SharingCatchUpProps {
  client: ClientView;
  /** Whom their packages are to be shared with, as the form says now, saved or not. */
  sharesWith: ReadonlyArray<string>;
}

/**
 * The client's packages with credits left that aren't shared with everyone
 * their packages are to be shared with: who to share each with is a default
 * for new packages only, so each one bought already is shared here, by the
 * user, never behind their back.
 */
export function SharingCatchUp({ client, sharesWith }: SharingCatchUpProps) {
  const packages = PackagesQuery.useList(true);
  const clientsById = ClientsQuery.useById();
  const update = PackagesMutation.useUpdate();
  const behind = (packages.data ?? [])
    .filter((pkg) => pkg.clientId === client.id && pkg.creditsLeft > 0)
    .map((pkg) => ({ pkg, missing: sharesWith.filter((id) => id !== client.id && !pkg.sharedWith.includes(id)) }))
    .filter(({ missing }) => missing.length > 0);
  if (behind.length === 0) return null;

  const names = (ids: ReadonlyArray<string>) => ids.map((id) => clientsById.get(id)?.name.split(" ")[0] ?? "someone").join(", ");
  const share = (pkg: PackageView, missing: ReadonlyArray<string>) =>
    update.mutate(
      { id: pkg.id, fields: { sharedWith: [...pkg.sharedWith, ...missing] } },
      { onSuccess: () => toast.success(`Shared with ${names(missing)}`), onError: toastRefusal },
    );

  return (
    <div className="flex flex-col gap-2">
      <FieldDescription>Packages bought already keep whom they were shared with:</FieldDescription>
      <ul className="flex flex-col gap-1.5 text-sm">
        {behind.map(({ pkg, missing }) => (
          <li key={pkg.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              Bought {formatDate(pkg.purchasedAt)} · {formatHours(pkg.creditsLeft)} left
              <span className="text-muted-foreground"> · not shared with {names(missing)}</span>
            </span>
            <Button type="button" variant="outline" size="xs" disabled={update.isPending} onClick={() => share(pkg, missing)}>
              Share with {missing.length > 1 ? "them" : names(missing)}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
