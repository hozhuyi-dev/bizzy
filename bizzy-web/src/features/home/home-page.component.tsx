import { useMemo } from "react";
import { HomeIcon } from "lucide-react";
import { ClientsQuery } from "~/features/clients/clients.query";
import { GoogleNotice } from "~/features/google/components/google-notice/google-notice.component";
import { NewSessionButton } from "~/features/sessions/components/new-session-button/new-session-button.component";
import { stageBadges } from "~/features/sessions/session-stage.util";
import { SessionsQuery } from "~/features/sessions/sessions.query";
import { TodoList } from "~/features/todo/components/todo-list/todo-list.component";
import { TodoQuery } from "~/features/todo/todo.query";
import { PageHeader } from "~/components/shared/page-header/page-header.component";
import { Loading } from "~/components/shared/quip/quip.component";
import { SectionLayout } from "~/components/shared/section-layout/section-layout.component";
import { TextLink } from "~/components/shared/text-link/text-link.component";
import { Badge } from "~/components/ui/badge";
import { queryMatch } from "~/core/utils/query.util";
import { clientOf } from "~/features/clients/clients.util";
import { dayRange } from "~/core/utils/date.util";

/**
 * Her day: today's sessions, then everything that needs her (sessions and
 * follow-ups in one list). The contents list doubles as the counts.
 */
export function HomePage() {
  const todo = TodoQuery.useList();
  const count = todo.data?.length;

  return (
    <>
      <PageHeader title="Home" actions={<NewSessionButton />} />
      <GoogleNotice />
      <SectionLayout
        sections={[
          { id: "today", title: "Today", content: <Today /> },
          {
            id: "todo",
            title: count ? `To do (${count})` : "To do",
            bare: true,
            content: queryMatch(todo, {
              pending: () => <Loading />,
              error: (error) => (
                <p role="alert" className="text-sm text-destructive">
                  {error.message}
                </p>
              ),
              success: (items) => <TodoList items={items} />,
            }),
          },
        ]}
      />
    </>
  );
}

/** Today's sessions, in order: a schedule to glance at, not tasks. */
function Today() {
  const { from, to } = useMemo(() => dayRange(), []);
  const sessions = SessionsQuery.useRange(from, to);
  const clientsById = ClientsQuery.useById();
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

  return queryMatch(sessions, {
    pending: () => <Loading />,
    error: (error) => (
      <p role="alert" className="text-sm text-destructive">
        {error.message}
      </p>
    ),
    success: (data) => {
      const today = [...data].sort((a, b) => a.start.localeCompare(b.start));
      if (today.length === 0) return <p className="text-sm text-muted-foreground">No sessions today.</p>;
      return (
        <ul className="flex flex-col divide-y">
          {today.map((session) => {
            const client = clientOf(clientsById, session.clientId);
            return (
              <li key={session.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                <span className="w-16 shrink-0 text-sm text-muted-foreground tabular-nums">
                  {time.format(new Date(session.start))}
                </span>
                <TextLink to="/sessions/$id" params={{ id: session.id }} search={{ from: "home" }}>
                  {client?.name ?? "Unknown client"}
                </TextLink>
                {session.location === "visit" && <HomeIcon className="size-3.5 text-muted-foreground" aria-label="Home visit" />}
                <span className="flex flex-wrap gap-1">
                  {stageBadges(session).map((badge) => (
                    <Badge key={badge.label} variant={badge.tone}>
                      {badge.label}
                    </Badge>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      );
    },
  });
}
