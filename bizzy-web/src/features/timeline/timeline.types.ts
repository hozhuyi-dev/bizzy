import type { DocumentStatus, DocumentSummary, DocumentType } from "~/features/documents/documents.types";
import type { FollowUpView } from "~/features/follow-ups/follow-ups.types";
import type { PackageView } from "~/features/packages/packages.types";
import type { SessionView } from "~/features/sessions/sessions.types";
import type { ListRequest, Page } from "~/core/list/filter.types";

// Mirrors bizzy-lambda/internal/features/timeline.

/** What an entry is; mirrors timeline.Kind. */
export type TimelineKind = "session" | "followUp" | "document" | "package";

/** A document an entry is on; mirrors timeline.DocumentRef. */
export interface TimelineDocumentRef {
  id: string;
  type: DocumentType;
  status: DocumentStatus;
  number?: string;
  totalCents: number;
  /** How many other sessions and packages it covers, each on an entry of its own. */
  others: number;
}

/** A session with what came of it; mirrors timeline.Session. */
export interface TimelineSession extends SessionView {
  /** The part of its notes with the words searched for. */
  excerpt?: string;
  followUps: Array<FollowUpView>;
  /** Its invoice and receipt, and those of the package bought in it. */
  documents: Array<TimelineDocumentRef>;
}

/** A package bought on its own; mirrors timeline.Package. */
export interface TimelinePackage extends PackageView {
  documents: Array<TimelineDocumentRef>;
}

/** A document covering more than one session or package; mirrors timeline.Document. */
export interface TimelineDocument extends DocumentSummary {
  covers: number;
}

/** One thing in a client's story; the part its kind names is set. Mirrors timeline.Entry. */
export type TimelineEntry =
  | { kind: "session"; at: string; session: TimelineSession }
  | { kind: "followUp"; at: string; followUp: FollowUpView }
  | { kind: "document"; at: string; document: TimelineDocument }
  | { kind: "package"; at: string; package: TimelinePackage };

/** A page of what has happened; the first also has all that is coming, newest first. Mirrors timeline.Page. */
export interface TimelinePage extends Page<TimelineEntry> {
  upcoming?: Array<TimelineEntry>;
}

/** timeline.search's request: no kinds takes every kind. */
export interface SearchTimelineRequest extends ListRequest {
  clientId: string;
  kinds: Array<TimelineKind>;
}
