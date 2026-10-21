import { useState } from "react";
import type { ClientView } from "../../clients.types";
import type { FollowUpTarget } from "~/features/follow-ups/follow-ups.types";
import { FollowUpDialog } from "~/features/follow-ups/components/follow-up-dialog/follow-up-dialog.component";
import { FollowUpRow } from "~/features/follow-ups/components/follow-up-row/follow-up-row.component";
import { FollowUpsQuery } from "~/features/follow-ups/follow-ups.query";
import { Loading } from "~/components/shared/quip/quip.component";
import { RowList, RowListItem } from "~/components/shared/row-list/row-list.component";
import { Button } from "~/components/ui/button";

/** The client's follow-ups, latest first, done or not. */
export function ClientFollowUps({ client }: { client: ClientView }) {
  const list = FollowUpsQuery.useByClient(client.id);
  const [target, setTarget] = useState<FollowUpTarget | null>(null);

  if (list.isPending) return <Loading />;
  if (list.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {list.error.message}
      </p>
    );
  }
  const items = list.data;

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No follow-ups with {client.name}.</p>
      ) : (
        <RowList>
          {items.map((followUp) => (
            <RowListItem key={followUp.id}>
              <FollowUpRow followUp={followUp} hideClient onEdit={(f) => setTarget({ mode: "edit", followUp: f })} />
            </RowListItem>
          ))}
        </RowList>
      )}
      <div>
        <Button variant="outline" size="sm" onClick={() => setTarget({ mode: "new", clientId: client.id })}>
          Add follow-up
        </Button>
      </div>
      <FollowUpDialog target={target} onClose={() => setTarget(null)} />
    </div>
  );
}
