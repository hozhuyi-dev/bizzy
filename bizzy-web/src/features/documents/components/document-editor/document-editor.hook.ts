import { useForm, useStore } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { DOCUMENT_TYPES } from "../../documents.constant";
import { toContent, toFormValues, validateContent } from "../../documents.form";
import { DocumentsMutation } from "../../documents.mutation";
import { DocumentPdfService } from "../../document-pdf.service";
import { documentLabel } from "../../documents.util";
import type { DocumentContent, DocumentView } from "../../documents.types";

/**
 * Free editing of everything printed on the document. Nothing is final until
 * Issue; a revision keeps its number. Split into a hook, its actions and its
 * fields so the page can put the actions in its header.
 */
export function useDocumentEditor(doc: DocumentView, draft: DocumentContent) {
  const save = DocumentsMutation.useSaveDraft();
  const issue = DocumentsMutation.useIssue();
  const discard = DocumentsMutation.useDiscardDraft();
  const navigate = useNavigate();
  const nextRevision = doc.number ? (doc.revision ?? 0) + 1 : undefined;

  const form = useForm({ defaultValues: toFormValues(draft) });
  const values = useStore(form.store, (state) => state.values);
  const content = toContent(values);
  const invalid = validateContent(values);

  const saveDraft = () => save.mutateAsync({ id: doc.id, content });

  return {
    doc,
    form,
    values,
    invalid,
    nextRevision,
    saving: save.isPending,
    issuing: issue.isPending,
    busy: save.isPending || issue.isPending || discard.isPending,

    save: async () => {
      try {
        await saveDraft();
        toast.success("Draft saved");
      } catch (error) {
        toast.error((error as Error).message);
      }
    },

    issue: async () => {
      try {
        const saved = await saveDraft();
        if (!saved) return;
        const issued = await issue.mutateAsync(saved.id);
        toast.success(`Issued ${issued ? documentLabel(issued.number, issued.revision) : ""}`);
      } catch (error) {
        toast.error((error as Error).message);
      }
    },

    discard: () =>
      discard.mutate(doc.id, {
        onSuccess: () => {
          if (doc.number) {
            toast.success("Revision discarded");
            return;
          }
          // A draft never issued is deleted, so its page is gone too.
          toast.success("Draft discarded");
          void navigate({ to: DOCUMENT_TYPES[doc.type].path });
        },
        onError: (error) => toast.error(error.message),
      }),

    /** The real PDF, watermarked DRAFT, from what is on screen now. */
    preview: () =>
      DocumentPdfService.open({ type: doc.type, number: doc.number, revision: nextRevision, watermark: "DRAFT", content }).catch(
        (error: unknown) => toast.error(error instanceof Error ? error.message : "Couldn't make the PDF"),
      ),
  };
}

export type DocumentEditorState = ReturnType<typeof useDocumentEditor>;
