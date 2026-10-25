import { RecordEditor } from "../record-editor/record-editor.component";
import type { PageStep, StepState } from "~/components/shared/layout/page-steps/page-steps.component";
import type { RecordDraft } from "../record-editor/record-editor.hook";
import type { SessionView } from "../../sessions.types";
import { AttachmentList } from "~/features/attachments/components/attachment-list/attachment-list.component";

export function recordStep(session: SessionView, record: RecordDraft): PageStep {
  const { can } = session;
  // Notes wait until the booking is confirmed.
  const blocked = session.todo.includes("confirm");
  const summary = record.summary.trim();
  const { files } = session.record;
  let state: StepState = "todo";
  if (summary) state = "done";
  else if (can.record.ok && !blocked) state = "current";
  return {
    id: "record",
    title: "Notes",
    state,
    meta: (
      <>
        {summary ? <span className="line-clamp-2">{summary}</span> : can.record.ok ? "Not written yet" : can.record.why}
        {files > 0 && <span className="text-muted-foreground"> · {files === 1 ? "1 file" : `${files} files`}</span>}
      </>
    ),
    content: (
      <>
        <RecordEditor draft={record} disabled={can.record.ok ? undefined : can.record.why} />
        {/* Files are attached under the same rule as notes. */}
        <AttachmentList owner={{ ownerKind: "session", ownerId: session.id }} can={can.record} />
      </>
    ),
  };
}
