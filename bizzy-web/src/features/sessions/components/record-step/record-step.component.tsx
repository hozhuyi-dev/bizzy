import { RecordEditor } from "../record-editor/record-editor.component";
import { needsFix } from "../../session-stage.util";
import type { PipelineStep, StepState } from "../pipeline-layout/pipeline-layout.component";
import type { RecordDraft } from "../record-editor/record-editor.hook";
import type { Session } from "../../sessions.types";

export function recordStep(session: Session, record: RecordDraft): PipelineStep {
  const started = new Date(session.start) <= new Date();
  const blocked = session.status === "tentative" || needsFix(session);
  const summary = record.summary.trim();
  let state: StepState = "todo";
  if (summary) state = "done";
  else if (started && !blocked) state = "current";
  return {
    id: "record",
    title: "Notes",
    state,
    meta: summary ? <span className="line-clamp-2">{summary}</span> : started ? "Not written yet" : "Once it has started",
    content: (
      <RecordEditor draft={record} disabled={started ? undefined : "Notes open once the session has started."} />
    ),
  };
}
