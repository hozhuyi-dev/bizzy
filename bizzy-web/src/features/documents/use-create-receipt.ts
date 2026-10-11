import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { DocumentsMutation } from "./documents.query";
import type { DocumentSource } from "./documents.types";

/** Starts a receipt draft for sessions and packages and opens it to edit. */
export function useCreateReceipt() {
  const navigate = useNavigate();
  const { mutate, isPending } = DocumentsMutation.useCreateDraft();

  const create = useCallback(
    (sources: Array<DocumentSource>) =>
      mutate(
        { type: "receipt", sources },
        {
          onSuccess: (doc) => {
            if (doc) void navigate({ to: "/receipts/$id", params: { id: doc.id } });
          },
          onError: (error) => toast.error(error.message),
        },
      ),
    [mutate, navigate],
  );

  return { create, isPending };
}
