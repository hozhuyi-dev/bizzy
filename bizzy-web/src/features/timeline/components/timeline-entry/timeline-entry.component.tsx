import { BellIcon, CalendarIcon, CheckIcon, FileTextIcon, PackageIcon, PencilIcon, ReceiptIcon } from "lucide-react";
import type { FollowUpView } from "~/features/follow-ups/follow-ups.types";
import type { TimelineDocument, TimelineDocumentRef, TimelineEntry, TimelinePackage, TimelineSession } from "../../timeline.types";
import type { Action } from "~/components/shared/actions/action-bar/action-bar.types";
import { lengthAndPlace, recordText, stageBadges } from "~/features/sessions/session-stage.util";
import { DocumentStatusBadge } from "~/features/documents/documents.columns";
import { DOCUMENT_TYPES } from "~/features/documents/documents.constant";
import { documentRoute, refLabel } from "~/features/documents/documents.util";
import { useMarkDone } from "~/features/follow-ups/follow-ups.hook";
import { formatDue, isOverdue } from "~/features/follow-ups/follow-ups.util";
import { TextLink } from "~/components/shared/link/text-link/text-link.component";
import { TimelineChip, TimelineItem, TimelineLink } from "~/components/shared/list/timeline/timeline.component";
import { Badge } from "~/components/ui/badge";
import { formatDate, formatHours, formatSessionTime } from "~/core/utils/date.util";
import { formatCents } from "~/core/utils/money.util";

/*
 * One entry of a timeline, each kind its own way on the rail (TimelineItem):
 * a session with what came of it as chips, a follow-up, a package bought on
 * its own, a document covering several things. For a client's timeline,
 * and any list of what a document or package covers.
 */

export interface TimelineEntryProps {
  entry: TimelineEntry;
  /** Coming, not happened yet. */
  upcoming?: boolean | undefined;
  /** Opens a follow-up to edit. */
  onEditFollowUp: (followUp: FollowUpView) => void;
}

export function TimelineEntryItem({ entry, upcoming, onEditFollowUp }: TimelineEntryProps) {
  switch (entry.kind) {
    case "session":
      return <SessionItem session={entry.session} upcoming={upcoming} />;
    case "followUp":
      return <FollowUpItem followUp={entry.followUp} upcoming={upcoming} onEdit={onEditFollowUp} />;
    case "document":
      return <DocumentItem doc={entry.document} />;
    case "package":
      return <PackageItem pkg={entry.package} />;
  }
}

/** A session: when, and how it stands; what was written; how long and where; what came of it. */
export function SessionItem({ session, upcoming }: { session: TimelineSession; upcoming?: boolean | undefined }) {
  const page = { to: "/sessions/$id", params: { id: session.id } } as const;
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
      when={<TextLink {...page}>{formatSessionTime(session.start)}</TextLink>}
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
            <DocumentLinks docs={session.documents} />
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
  const { mark, isPending } = useMarkDone();
  const done = Boolean(followUp.doneAt);
  const overdue = isOverdue(followUp);
  const actions: Array<Action> = done
    ? []
    : [
        { type: "button", label: "Done", icon: CheckIcon, disabled: isPending, onClick: () => mark(followUp) },
        { type: "button", label: "Edit", icon: PencilIcon, style: "quiet", iconOnlyOnPhone: true, onClick: () => onEdit(followUp) },
      ];
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
          <TimelineLink to="/sessions/$id" params={{ id: followUp.sessionId }}>
            <CalendarIcon className="size-3" aria-hidden="true" /> From a session
          </TimelineLink>
        )
      }
      actions={actions}
      onOpen={() => onEdit(followUp)}
    />
  );
}

/** A package bought on its own: its hours and price, what is left, its documents. */
export function PackageItem({ pkg }: { pkg: TimelinePackage }) {
  return (
    <TimelineItem
      icon={PackageIcon}
      tone={pkg.owedCents > 0 ? "attention" : "neutral"}
      when={formatDate(pkg.purchasedAt)}
      badges={pkg.owedCents > 0 && <Badge variant="attention">Unpaid</Badge>}
      title={`${formatHours(pkg.hours)} package for ${formatCents(pkg.priceCents)}`}
      meta={[`${formatHours(pkg.creditsLeft)} left`, pkg.note].filter(Boolean).join(" · ")}
      links={pkg.documents.length > 0 && <DocumentLinks docs={pkg.documents} />}
    />
  );
}

/** A document covering several sessions or packages, where the newest of them is. */
export function DocumentItem({ doc }: { doc: TimelineDocument }) {
  const page = { to: documentRoute(doc.type), params: { id: doc.id } } as const;
  return (
    <TimelineItem
      icon={doc.type === "invoice" ? FileTextIcon : ReceiptIcon}
      tone={doc.status === "draft" ? "neutral" : "info"}
      when={doc.date ? formatDate(doc.date) : "Dated when issued"}
      badges={<DocumentStatusBadge status={doc.status} revising={doc.revising} />}
      title={<TextLink {...page}>{refLabel(doc.type, doc, doc.status !== "draft")}</TextLink>}
      meta={`${DOCUMENT_TYPES[doc.type].title} for ${doc.covers} sessions and packages · ${formatCents(doc.totalCents)}`}
      open={page}
    />
  );
}

/** "INV-0012 (+3)": an entry's documents, saying how many others each covers. */
function DocumentLinks({ docs }: { docs: ReadonlyArray<TimelineDocumentRef> }) {
  return docs.map((doc) => {
    const Icon = doc.type === "invoice" ? FileTextIcon : ReceiptIcon;
    return (
      <TimelineLink key={doc.id} to={documentRoute(doc.type)} params={{ id: doc.id }}>
        <Icon className="size-3" aria-hidden="true" />
        {refLabel(doc.type, doc, doc.status !== "draft")}
        {doc.others > 0 && <span className="text-muted-foreground">(+{doc.others})</span>}
      </TimelineLink>
    );
  });
}
