import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { DocumentsMutation } from "./documents.query";
import { documentRoute } from "./documents.registry";
import type { DocumentSource, DocumentType } from "./documents.types";

/** Starts a draft invoice or receipt for sessions and packages and opens it to edit. */
export function useCreateDocument() {
  const navigate = useNavigate();
  const { mutate, isPending } = DocumentsMutation.useCreateDraft();

  const create = useCallback(
    (type: DocumentType, sources: Array<DocumentSource>) =>
      mutate(
        { type, sources },
        {
          onSuccess: (doc) => {
            if (doc) void navigate({ to: documentRoute(type), params: { id: doc.id } });
          },
          onError: (error) => toast.error(error.message),
        },
      ),
    [mutate, navigate],
  );

  return { create, isPending };
}
