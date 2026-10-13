import { RecordEditor } from "../record-editor/record-editor.component";
import { needsFix } from "../../session-stage.util";
import type { PipelineStep, StepState } from "../pipeline-layout/pipeline-layout.component";
import type { RecordDraft } from "../record-editor/record-editor.hook";
import type { Session } from "../../sessions.types";
import { AttachmentList } from "~/features/attachments/components/attachment-list/attachment-list.component";

export function recordStep(session: Session, record: RecordDraft): PipelineStep {
  const { can } = session;
  // Notes wait until the booking is confirmed and fixed.
  const blocked = session.todo.includes("confirm") || needsFix(session);
  const summary = record.summary.trim();
  const files = session.record?.files ?? 0;
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
        <AttachmentList owner={{ ownerKind: "session", ownerId: session.eventId }} can={can.attach} />
      </>
    ),
  };
}
