import { totals } from "../../client-activity.util";
import { toClientRow } from "../../clients.util";
import type { ClientView } from "../../clients.types";
import { ActivityQuery } from "~/features/activity/activity.query";
import { Fact, FactList } from "~/components/shared/layout/fact-list/fact-list.component";
import { Card, CardContent } from "~/components/ui/card";
import { formatDate, formatHours } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

/**
 * Where the client stands, as the API works it out: what is next, their
 * last session, what they owe and have left, when they were last in
 * touch, and what they have spent. What is coming, item by item, is at the
 * top of the timeline.
 */
export function ClientOverview({ client }: { client: ClientView }) {
  const activity = ActivityQuery.useByClient().get(client.id);
  const row = toClientRow(client, activity);
  const next = row.next;

  return (
    <Card>
      <CardContent>
        <FactList>
          <Fact label="Next">
            {next ? `${next.kind === "session" ? "Booked" : "Follow-up"} ${formatDate(next.at)}` : "Nothing booked"}
          </Fact>
          <Fact label="Last session">
            {row.lastSessionAt ? formatDate(row.lastSessionAt) : "—"}
            {row.monthsSince !== undefined && row.monthsSince > 0 && (
              <span className="text-muted-foreground"> · {row.monthsSince} mo ago</span>
            )}
          </Fact>
          <Fact label="Last contacted">{row.lastContactedAt ? formatDate(row.lastContactedAt) : "—"}</Fact>
          <Fact label="Owed">{row.owedCents > 0 ? formatCents(row.owedCents) : "Nothing"}</Fact>
          <Fact label="Package credits">
            {row.creditsLeftMinutes > 0 ? `${formatHours(row.creditsLeftMinutes / 60)} left` : "None"}
          </Fact>
          <Fact label="To record">{activity?.unrecorded ? `${activity.unrecorded} sessions` : "None"}</Fact>
          <Fact label="Last 12 months">
            {formatCents(row.revenue12Cents)}
            <span className="text-muted-foreground"> · {row.sessions12} sessions</span>
          </Fact>
          <Fact label="Lifetime">
            {formatCents(row.lifetimeCents)}
            <span className="text-muted-foreground"> · {totals(activity).sessions} sessions</span>
          </Fact>
        </FactList>
      </CardContent>
    </Card>
  );
}
