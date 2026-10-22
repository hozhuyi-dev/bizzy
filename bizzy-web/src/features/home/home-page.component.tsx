import { useMemo, useState } from "react";
import { BellPlusIcon, HomeIcon, PackagePlusIcon, ReceiptIcon, UserPlusIcon } from "lucide-react";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import type { FollowUpTarget } from "~/features/follow-ups/follow-ups.types";
import { FollowUpDialog } from "~/features/follow-ups/components/follow-up-dialog/follow-up-dialog.component";
import { PackageForm } from "~/features/packages/components/package-form/package-form.component";
import { SheetDialog } from "~/components/shared/dialog/sheet-dialog/sheet-dialog.component";
import { DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { ClientsQuery } from "~/features/clients/clients.query";
import { NewSessionDialog } from "~/features/sessions/components/booking-dialog/booking-dialog.component";
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
import { queryMatch } from "~/core/utils/query.util";
import { clientOf } from "~/features/clients/clients.util";
import { dayRange } from "~/core/utils/date.util";
import { ErrorMessage } from "~/components/shared/feedback/error-message/error-message.component";

/**
 * The user's day: today's sessions, then everything that needs them
 * (sessions and follow-ups in one list). The contents list doubles as the
 * counts. The header starts anything new without a trip to its list:
 * a session first, the rest beside it on a wide screen, behind ⋯ below.
 */
export function HomePage() {
  const todo = TodoQuery.useList();
  const count = todo.data?.length;
  const [adding, setAdding] = useState(false);
  const [addingPackage, setAddingPackage] = useState(false);
  const [followUp, setFollowUp] = useState<FollowUpTarget | null>(null);
  const shortcuts: Array<Action> = [
    { type: "link", label: "New client", icon: UserPlusIcon, link: { to: "/clients/new" } },
    { type: "button", label: "New package", icon: PackagePlusIcon, onClick: () => setAddingPackage(true) },
    { type: "button", label: "New follow-up", icon: BellPlusIcon, onClick: () => setFollowUp({ mode: "new" }) },
    { type: "link", label: "New expense", icon: ReceiptIcon, link: { to: "/expenses/new" } },
  ];

  return (
    <>
      <PageHeader
        title="Home"
        actions={[newSessionAction(() => setAdding(true))]}
        moreActions={shortcuts}
        foldBelow="lg"
      />
      <NewSessionDialog open={adding} returnTo="home" onClose={() => setAdding(false)} />
      <FollowUpDialog target={followUp} onClose={() => setFollowUp(null)} />
      <SheetDialog open={addingPackage} onClose={() => setAddingPackage(false)}>
        <DialogHeader>
          <DialogTitle>New package</DialogTitle>
        </DialogHeader>
        {addingPackage && <PackageForm onDone={() => setAddingPackage(false)} />}
      </SheetDialog>
      <PageSections
        sections={[
          { id: "today", title: "Today", content: <Today /> },
          {
            id: "todo",
            title: count ? `To do (${count})` : "To do",
            bare: true,
            content: queryMatch(todo, {
              pending: () => <LoadingState />,
              error: (error) => (
                <ErrorMessage>{error.message}</ErrorMessage>
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
    pending: () => <LoadingState />,
    error: (error) => (
      <ErrorMessage>{error.message}</ErrorMessage>
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
