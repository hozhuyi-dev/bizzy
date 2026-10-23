import { createFileRoute, redirect } from "@tanstack/react-router";

/** Invoices are a type in the documents list now; an old link lands there, with what it asked for. */
export const Route = createFileRoute("/invoices/")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/documents", search: { ...search, type: ["invoice"] }, replace: true });
  },
});
