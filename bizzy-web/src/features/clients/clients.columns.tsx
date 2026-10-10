import type { Client } from "./clients.types";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { createDataTableColumnHelper } from "~/components/shared/data-table/data-table.features";
import { formatCents } from "~/core/utils/money.util";

const helper = createDataTableColumnHelper<Client>();

/** Aliases other than the client's own name, which is always one of them. */
export function extraAliases(client: Client): Array<string> {
  const name = client.name.toLowerCase();
  return client.aliases.filter((alias) => alias !== name);
}

export function createClientColumns(onEdit: (client: Client) => void) {
  return helper.columns([
    helper.accessor("name", {
      header: "Name",
      sortFn: "alphanumeric",
    }),
    helper.display({
      id: "aliases",
      header: "Calendar names",
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {extraAliases(row.original).map((alias) => (
            <Badge key={alias} variant="secondary">
              {alias}
            </Badge>
          ))}
        </div>
      ),
    }),
    helper.accessor("defaultFeeCents", {
      header: "Default fee",
      sortFn: "basic",
      sortUndefined: "last",
      cell: ({ getValue }) => {
        const cents = getValue();
        return cents === undefined ? "—" : formatCents(cents);
      },
    }),
    helper.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => onEdit(row.original)}>
          Edit
        </Button>
      ),
    }),
  ]);
}
