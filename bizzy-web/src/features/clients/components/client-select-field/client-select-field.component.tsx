import { ClientsQuery } from "../../clients.query";
import { pickableClients } from "../../clients.util";
import type { ReactNode } from "react";
import { SelectField } from "~/components/shared/form/form-fields.component";

interface ClientSelectFieldProps {
  /** The client already chosen, kept in the list even once archived. */
  keepId?: string | undefined;
  disabled?: boolean | undefined;
  /** Why it can't change now (a LockedHint). */
  hint?: ReactNode;
}

/**
 * Who it is for, inside a form.AppField for a client id: every client but
 * the archived (unless it is the one chosen), by name.
 */
export function ClientSelectField({ keepId, disabled, hint }: ClientSelectFieldProps) {
  const clients = ClientsQuery.useList();
  const items = pickableClients(clients.data ?? [], keepId);
  return <SelectField label="Client" placeholder="Choose a client" items={items} disabled={disabled} hint={hint} />;
}
