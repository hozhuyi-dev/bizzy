import { useMemo, useState } from "react";
import { BellPlusIcon, HomeIcon, PackagePlusIcon, ReceiptIcon, UserPlusIcon } from "lucide-react";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { Loadable } from "~/core/utils/query.util";
import { useOpenFollowUp } from "~/features/follow-ups/follow-ups.hook";
import { useOpenPackage } from "~/features/packages/package-open.hook";
import { ClientsQuery } from "~/features/clients/clients.query";
import { newSessionAction } from "~/features/sessions/sessions.util";
import { stageBadges } from "~/features/sessions/session-stage.util";
import { SessionsQuery } from "~/features/sessions/sessions.query";
import { TodoList } from "~/features/todo/components/todo-list/todo-list.component";
import { TodoQuery } from "~/features/todo/todo.query";
import { PageHeader } from "~/components/shared/layout/page-header/page-header.component";
import { LoadingState } from "~/components/shared/feedback/loading-state/loading-state.component";
import { PageSections } from "~/components/shared/layout/page-sections/page-sections.component";
import { TextLink } from "~/components/shared/link/text-link/text-link.component";
import { Badge } from "~/components/ui/badge";
import { allOf } from "~/core/utils/query.util";
import { clientOf } from "~/features/clients/clients.util";
import { dayRange } from "~/core/utils/date.util";
import { ErrorState } from "~/components/shared/feedback/error-state/error-state.component";
import { EmptyState } from "~/components/shared/feedback/empty-state/empty-state.component";
import { QUIPS } from "~/core/constants/quips.constant";

/**
 * The user's day: today's sessions, then everything that needs them
 * (sessions and follow-ups in one list). The contents list doubles as the
 * counts. The header starts anything new without a trip to its list:
 * a session first, the rest beside it on a wide screen, behind ⋯ below.
 */
export function HomePage() {
  const todo = TodoQuery.useList();
  // Both parts name clients: each opens with them.
  const clients = ClientsQuery.useList();
  const count = todo.data?.length;
  const openPackage = useOpenPackage();
  const openFollowUp = useOpenFollowUp();
  const shortcuts: Array<Action> = [
    { type: "link", label: "New client", icon: UserPlusIcon, link: { to: "/clients/new" } },
    { type: "button", label: "New package", icon: PackagePlusIcon, onClick: () => openPackage({ mode: "new" }) },
    { type: "button", label: "New follow-up", icon: BellPlusIcon, onClick: () => openFollowUp({ mode: "new" }) },
    { type: "link", label: "New expense", icon: ReceiptIcon, link: { to: "/expenses/new" } },
  ];

  return (
    <>
      <PageHeader
        title="Home"
        actions={[newSessionAction("home")]}
        moreActions={shortcuts}
        foldBelow="lg"
      />
      <PageSections
        sections={[
          { id: "today", title: "Today", content: <Today /> },
          {
            id: "todo",
            title: count ? `To do (${count})` : "To do",
            bare: true,
            content:
              todo.data && clients.data ? (
                <TodoList items={todo.data} />
              ) : (
                <Waiting on={allOf(todo, clients)} />
              ),
          },
        ]}
      />
    </>
  );
}

/** A part of Home while it reads: its lines, or why it didn't load. */
function Waiting({ on }: { on: Loadable }) {
  return on.error ? <ErrorState error={on.error} retry={on.refetch} /> : <LoadingState />;
}

/** Today's sessions, in order: a schedule to glance at, not tasks. */
function Today() {
  const { from, to } = useMemo(() => dayRange(), []);
  const sessions = SessionsQuery.useRange(from, to);
  const clients = ClientsQuery.useList();
  const clientsById = ClientsQuery.useById();
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

  const data = sessions.data;
  if (!data || !clients.data) return <Waiting on={allOf(sessions, clients)} />;
  const today = [...data].sort((a, b) => a.start.localeCompare(b.start));
  if (today.length === 0) return <EmptyState quips={QUIPS.sessionsToday}>No sessions today.</EmptyState>;
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
}
