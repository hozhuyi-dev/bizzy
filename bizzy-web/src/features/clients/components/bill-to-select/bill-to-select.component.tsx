import { useId } from "react";
import { ClientsQuery } from "../../clients.query";
import { pickableClients } from "../../clients.util";
import type { ReactNode } from "react";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";

interface BillToSelectProps {
  /** Who pays now. */
  payer: string;
  /** Bills it to another client, at once: no Save. */
  onChange: (clientId: string) => void;
  disabled?: boolean | undefined;
  /** Under it: what it decides. */
  description?: ReactNode;
  /** Why it can't change now (a LockedHint). */
  hint?: ReactNode;
}

/**
 * Who pays for a session or a document, picked from every client (the one
 * paying kept, archived or not) and saved as soon as it is picked: what
 * the WhatsApp messages ask, and whose invoice it is on.
 */
export function BillToSelect({ payer, onChange, disabled, description, hint }: BillToSelectProps) {
  const clients = ClientsQuery.useList();
  const items = pickableClients(clients.data ?? [], payer);
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>Billed to</FieldLabel>
      <Select
        items={items}
        value={payer}
        disabled={disabled}
        onValueChange={(value) => {
          if (value && value !== payer) onChange(value);
        }}
      >
        <SelectTrigger id={id} className="h-(--control-height) w-full max-w-72">
          <SelectValue placeholder="Choose who pays" />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {description && <FieldDescription>{description}</FieldDescription>}
      {hint}
    </Field>
  );
}
