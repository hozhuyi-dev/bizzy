import { DOCUMENT_STATUS } from "../../documents.constant";
import type { DocumentStatus } from "../../documents.types";
import { Badge } from "~/components/ui/badge";

export function DocumentStatusBadge({ status, revising }: { status: DocumentStatus; revising?: boolean | undefined }) {
  return (
    <span className="flex flex-wrap gap-1">
      <Badge variant={DOCUMENT_STATUS[status].variant}>{DOCUMENT_STATUS[status].label}</Badge>
      {revising && <Badge variant="waiting">Revising</Badge>}
    </span>
  );
}
