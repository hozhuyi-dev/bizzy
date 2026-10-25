import { useState } from "react";
import { useSelector } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { DOCUMENT_TYPES } from "../../documents.constant";
import { toContent, toFormValues } from "../../documents.form";
import { DocumentsMutation } from "../../documents.mutation";
import { DocumentPdfService } from "../../document-pdf.service";
import { DocumentsService } from "../../documents.service";
import { documentLabel } from "../../documents.util";
import type { DocumentContent, DocumentView } from "../../documents.types";
import { useAppForm } from "~/components/shared/form/form.hook";
import { toastRefusal } from "~/features/remedies/components/remedy-buttons/remedy-buttons.component";

/** What a submit of the editor is for: each checks the fields first. */
interface EditorSubmit {
  action: "save" | "issue" | "preview";
}

/** Enter in a field saves the draft. */
const SAVE: EditorSubmit = { action: "save" };

/**
 * Free editing of everything printed on the document. Nothing is final until
 * Issue; a revision keeps its number. Split into a hook, its actions and its
 * fields so the page can put the actions in its header.
 */
export function useDocumentEditor(doc: DocumentView, draft: DocumentContent) {
  const save = DocumentsMutation.useSaveDraft();
  const issue = DocumentsMutation.useIssue();
  const discard = DocumentsMutation.useDiscardDraft();
  const move = DocumentsMutation.useMoveLines();
  const navigate = useNavigate();
  // Adding sessions to it, in place at the top of its lines.
  const [adding, setAdding] = useState(false);
  const nextRevision = doc.number ? (doc.revision ?? 0) + 1 : undefined;

  const form = useAppForm({
    defaultValues: toFormValues(draft),
    onSubmitMeta: SAVE,
    onSubmit: async ({ value, meta }) => {
      const content = toContent(value);
      try {
        switch (meta.action) {
          case "save":
            await save.mutateAsync({ id: doc.id, content });
            toast.success("Draft saved");
            return;
          case "issue": {
            const saved = await save.mutateAsync({ id: doc.id, content });
            if (!saved) return;
            const issued = await issue.mutateAsync(saved.id);
            toast.success(`Issued ${issued ? documentLabel(issued.number, issued.revision) : ""}`);
            return;
          }
          case "preview":
            // The PDF as the API would issue it now, watermarked DRAFT, from what is on screen.
            await DocumentPdfService.open(() => DocumentsService.preview(doc.id, content));
            return;
        }
      } catch (error) {
        toastRefusal(error);
      }
    },
  });
  const values = useSelector(form.store, (state) => state.values);
  // A save refetches the document, which starts the editor afresh.
  const hasChanges = useSelector(form.store, (state) => !state.isDefaultValue);

  return {
    doc,
    form,
    values,
    hasChanges,
    nextRevision,
    saving: save.isPending,
    issuing: issue.isPending,
    busy: save.isPending || issue.isPending || discard.isPending || move.isPending,
    adding,
    setAdding,
    /**
     * Whether its lines can move between drafts: as its `can` says, and
     * saved, as moving one starts the editor afresh from what is stored.
     */
    canMove: doc.can.moveLines.ok && !hasChanges,

    /** Puts a line on a draft of its own, from one that covers other things too. */
    moveOut: (lineId: string) =>
      move.mutate(
        { from: doc.id, lineIds: [lineId] },
        {
          onSuccess: () => toast.success(`Moved to a ${DOCUMENT_TYPES[doc.type].title.toLowerCase()} of its own`),
          onError: toastRefusal,
        },
      ),

    save: () => form.handleSubmit({ action: "save" }),
    issue: () => form.handleSubmit({ action: "issue" }),
    preview: () => form.handleSubmit({ action: "preview" }),

    discard: () =>
      discard.mutate(doc.id, {
        onSuccess: () => {
          if (doc.number) {
            toast.success("Revision discarded");
            return;
          }
          // A draft never issued is deleted, so its page is gone too.
          toast.success("Draft discarded");
          void navigate({ to: "/documents", ignoreBlocker: true });
        },
        onError: toastRefusal,
      }),
  };
}

export type DocumentEditorState = ReturnType<typeof useDocumentEditor>;
