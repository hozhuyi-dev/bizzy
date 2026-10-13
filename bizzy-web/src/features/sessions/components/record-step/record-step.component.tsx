import { RecordEditor } from "../record-editor/record-editor.component";
import { needsFix } from "../../session-stage.util";
import type { PipelineStep, StepState } from "../pipeline-layout/pipeline-layout.component";
import type { RecordDraft } from "../record-editor/record-editor.hook";
import type { Session } from "../../sessions.types";

export function recordStep(session: Session, record: RecordDraft): PipelineStep {
  const { can } = session;
  // Notes wait until the booking is confirmed and fixed.
  const blocked = session.todo.includes("confirm") || needsFix(session);
  const summary = record.summary.trim();
  let state: StepState = "todo";
  if (summary) state = "done";
  else if (can.record.ok && !blocked) state = "current";
  return {
    id: "record",
    title: "Notes",
    state,
    meta: summary ? <span className="line-clamp-2">{summary}</span> : can.record.ok ? "Not written yet" : can.record.why,
    content: (
      <RecordEditor draft={record} disabled={can.record.ok ? undefined : can.record.why} />
    ),
  };
}
