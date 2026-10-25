import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { PackageTarget } from "./packages.types";

/**
 * Opens a package's page: one to edit, at its payment to pay for it, or a
 * new one, for a client when given (kept in history, not the URL: see
 * HistoryState).
 */
export function useOpenPackage(): (target: PackageTarget) => void {
  const navigate = useNavigate();
  return useCallback(
    (target: PackageTarget) =>
      target.mode === "edit"
        ? void navigate({ to: "/packages/$id", params: { id: target.pkg.id }, state: { at: target.at } })
        : void navigate({ to: "/packages/new", state: { clientId: target.clientId } }),
    [navigate],
  );
}
