import { BellIcon, CalendarIcon, CheckIcon, FileTextIcon, PackageIcon, ReceiptIcon } from "lucide-react";
import type { FollowUpView } from "~/features/follow-ups/follow-ups.types";
import type { TimelineDocument, TimelineDocumentRef, TimelineEntry, TimelinePackage, TimelineSession } from "../../timeline.types";
import type { PackageView } from "~/features/packages/packages.types";
import type { SessionView } from "~/features/sessions/sessions.types";
import type { DocumentSearch } from "~/features/documents/documents.types";
import { lengthAndPlace, recordText, stageBadges } from "~/features/sessions/session-stage.util";
import { DocumentStatusBadge } from "~/features/documents/documents.columns";
import { DOCUMENT_TYPES } from "~/features/documents/documents.constant";
import { coversText, documentRoute, refLabel } from "~/features/documents/documents.util";
import { clientSessionsSearch } from "~/features/sessions/sessions.util";
import { IssueButton } from "~/features/documents/components/issue-button/issue-button.component";
import { FollowUpDoneButton } from "~/features/follow-ups/components/follow-up-done-button/follow-up-done-button.component";
import { formatDue, isOverdue } from "~/features/follow-ups/follow-ups.util";
import { packagePayables } from "~/features/packages/packages.util";
import { PaidMenu } from "~/features/payments/components/paid-menu/paid-menu.component";
import { ANOTHER_DAY } from "~/features/payments/paid-action.hook";
import { SessionQuickActions } from "~/features/sessions/components/session-quick-actions/session-quick-actions.component";
import { TimelineChip, TimelineItem, TimelineLink } from "~/components/shared/list/timeline/timeline.component";
import { Badge } from "~/components/ui/badge";
import { formatDate, formatHours, formatSessionTime } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

/*
 * One entry of a timeline, each kind its own way on the rail (TimelineItem):
 * a session with what came of it as chips, a follow-up, a package bought on
 * its own, a document covering several things. For a client's timeline,
 * and any list of what a document or package covers.
 *
 * Each opens with a click on it (its page, or its edit dialog), and has
 * buttons only for what is left to do on it, the same ones its to-do row
 * has: Confirm, Add summary or Paid on a session, Done on a follow-up,
 * Paid on a package, Issue on a draft. Settled, it has none.
 */

/** The dialogs a timeline's entries open, which the timeline keeps. */
export interface TimelineHandlers {
  /** Whose timeline it is: an entry's page steps through the timeline's entries of its kind. */
  clientId: string;
  onEditFollowUp: (followUp: FollowUpView) => void;
  /** Its dialog; at its payment, to pay for it another day. */
  onEditPackage: (pkg: PackageView, at?: "payment") => void;
  onCancelSession: (session: SessionView) => void;
}

export interface TimelineEntryProps {
  entry: TimelineEntry;
  /** Coming, not happened yet. */
  upcoming?: boolean | undefined;
  handlers: TimelineHandlers;
}

export function TimelineEntryItem({ entry, upcoming, handlers }: TimelineEntryProps) {
  switch (entry.kind) {
    case "session":
      return <SessionItem session={entry.session} upcoming={upcoming} handlers={handlers} />;
    case "followUp":
      return <FollowUpItem followUp={entry.followUp} upcoming={upcoming} onEdit={handlers.onEditFollowUp} />;
    case "document":
      return <DocumentItem doc={entry.document} clientId={handlers.clientId} />;
    case "package":
      return <PackageItem pkg={entry.package} handlers={handlers} />;
  }
}

interface SessionItemProps {
  session: TimelineSession;
  upcoming?: boolean | undefined;
  handlers: TimelineHandlers;
}

/** A session: when, and how it stands; what was written; how long and where; what came of it. */
export function SessionItem({ session, upcoming, handlers }: SessionItemProps) {
  const page = { to: "/sessions/$id", params: { id: session.id }, search: { timeline: handlers.clientId } } as const;
  const badges = stageBadges(session);
  const summary = session.excerpt ?? session.record.summary;
  const meta = [
    lengthAndPlace(session),
    session.bought && `Bought ${formatHours(session.bought.hours)} package`,
    recordText(session.record),
  ];
  return (
    <TimelineItem
      icon={CalendarIcon}
      tone={badges[0]?.tone}
      upcoming={upcoming}
      when={formatSessionTime(session.start)}
      badges={badges.map((badge) => (
        <Badge key={badge.label} variant={badge.tone}>
          {badge.label}
        </Badge>
      ))}
      title={summary || (upcoming ? undefined : <span className="text-muted-foreground italic">No notes</span>)}
      meta={meta.filter(Boolean).join(" · ")}
      links={
        (session.documents.length > 0 || session.followUps.length > 0 || session.credits.length > 0) && (
          <>
            <DocumentLinks docs={session.documents} search={{ session: session.id }} />
            {session.credits.map((credit) => (
              <TimelineChip key={credit.packageId}>
                <PackageIcon className="size-3" aria-hidden="true" />
                {formatHours(credit.hours)} from package
              </TimelineChip>
            ))}
            {session.followUps.map((f) => (
              <TimelineChip key={f.id}>
                <BellIcon className="size-3" aria-hidden="true" />
                {f.summary || "Follow up"} · {formatDate(f.due)}
                {f.doneAt && <CheckIcon className="size-3" aria-label="done" />}
              </TimelineChip>
            ))}
          </>
        )
      }
      buttons={<SessionQuickActions session={session} onCancel={handlers.onCancelSession} />}
      open={page}
    />
  );
}

interface FollowUpItemProps {
  followUp: FollowUpView;
  upcoming?: boolean | undefined;
  onEdit: (followUp: FollowUpView) => void;
}

/** A follow-up: when due, what about; waiting, it can be marked done here. */
export function FollowUpItem({ followUp, upcoming, onEdit }: FollowUpItemProps) {
  const done = Boolean(followUp.doneAt);
  const overdue = isOverdue(followUp);
  return (
    <TimelineItem
      icon={BellIcon}
      tone={done ? "done" : overdue ? "attention" : "waiting"}
      upcoming={upcoming}
      when={formatDue(followUp)}
      badges={
        done ? <Badge variant="done">Done</Badge> : overdue ? <Badge variant="attention">Overdue</Badge> : <Badge variant="waiting">Follow-up</Badge>
      }
      title={followUp.summary || "Follow up"}
      meta={followUp.notes}
      links={
        followUp.sessionId && (
          <TimelineLink to="/sessions/$id" params={{ id: followUp.sessionId }} search={clientSessionsSearch(followUp.clientId)}>
            <CalendarIcon className="size-3" aria-hidden="true" /> From a session
          </TimelineLink>
        )
      }
      buttons={<FollowUpDoneButton followUp={followUp} />}
      onOpen={() => onEdit(followUp)}
    />
  );
}

/** A package bought on its own: its hours and price, what is left, its documents. */
export function PackageItem({ pkg, handlers }: { pkg: TimelinePackage; handlers: TimelineHandlers }) {
  const payables = pkg.can.pay.ok ? packagePayables(pkg).filter((p) => !p.paid) : [];
  return (
    <TimelineItem
      icon={PackageIcon}
      tone={pkg.owedCents > 0 ? "attention" : "neutral"}
      when={formatDate(pkg.purchasedAt)}
      badges={pkg.owedCents > 0 && <Badge variant="attention">Unpaid</Badge>}
      title={`${formatHours(pkg.hours)} package for ${formatCents(pkg.priceCents)}`}
      meta={[`${formatHours(pkg.creditsLeft)} left`, pkg.note].filter(Boolean).join(" · ")}
      links={pkg.documents.length > 0 && <DocumentLinks docs={pkg.documents} search={{ package: pkg.id }} />}
      buttons={
        payables.length > 0 && (
          <PaidMenu
            payables={payables}
            another={{ type: "button", label: ANOTHER_DAY, onClick: () => handlers.onEditPackage(pkg, "payment") }}
          />
        )
      }
      onOpen={() => handlers.onEditPackage(pkg)}
    />
  );
}

/** A document covering several sessions or packages, where the newest of them is; its page steps through the timeline's. */
export function DocumentItem({ doc, clientId }: { doc: TimelineDocument; clientId: string }) {
  const page = { to: documentRoute(doc.type), params: { id: doc.id }, search: { timeline: clientId } } as const;
  return (
    <TimelineItem
      icon={doc.type === "invoice" ? FileTextIcon : ReceiptIcon}
      tone={doc.status === "draft" ? "neutral" : "info"}
      when={doc.date ? formatDate(doc.date) : "Dated when issued"}
      badges={<DocumentStatusBadge status={doc.status} revising={doc.revising} />}
      title={<span className="font-medium">{refLabel(doc.type, doc, doc.status !== "draft")}</span>}
      meta={`${DOCUMENT_TYPES[doc.type].title} · ${coversText(doc.covers)} · ${formatCents(doc.totalCents)}`}
      buttons={doc.status === "draft" && <IssueButton id={doc.id} />}
      open={page}
    />
  );
}

/** "INV-0012 (+3)": an entry's documents, saying how many others each covers; each page steps through the entry's. */
function DocumentLinks({ docs, search }: { docs: ReadonlyArray<TimelineDocumentRef>; search: DocumentSearch }) {
  return docs.map((doc) => {
    const Icon = doc.type === "invoice" ? FileTextIcon : ReceiptIcon;
    return (
      <TimelineLink key={doc.id} to={documentRoute(doc.type)} params={{ id: doc.id }} search={search}>
        <Icon className="size-3" aria-hidden="true" />
        {refLabel(doc.type, doc, doc.status !== "draft")}
        {doc.others > 0 && <span className="text-muted-foreground">(+{doc.others})</span>}
      </TimelineLink>
    );
  });
}
