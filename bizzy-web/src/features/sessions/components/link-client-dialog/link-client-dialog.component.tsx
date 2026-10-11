import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type { Session } from "../../sessions.types";
import { ClientsMutation, profileOf } from "~/features/clients/clients.mutation";
import { ClientsQuery } from "~/features/clients/clients.query";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";

interface LinkClientDialogProps {
  session: Session | null;
  onClose: () => void;
}

/**
 * Links an unmatched calendar name to a client by adding it as one of their
 * calendar names, or creates the client. Every session with that name then
 * matches, now and in future syncs.
 */
export function LinkClientDialog({ session, onClose }: LinkClientDialogProps) {
  return (
    <Dialog open={session !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {session && <LinkClientBody key={session.eventId} session={session} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function LinkClientBody({ session, onClose }: { session: Session; onClose: () => void }) {
  const clients = ClientsQuery.useList();
  const save = ClientsMutation.useSave();
  const navigate = useNavigate();
  const [clientId, setClientId] = useState(session.suggestedClientId ?? "");
  const name = session.name ?? "";

  const items = (clients.data ?? [])
    .map((client) => ({ value: client.id, label: client.name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const link = () => {
    const client = clients.data?.find((c) => c.id === clientId);
    if (!client) return;
    save.mutate(
      { ...profileOf(client), aliases: [...client.aliases, name] },
      {
        onSuccess: () => {
          toast.success(`“${name}” now matches ${client.name}`);
          onClose();
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Who is “{name}”?</DialogTitle>
        <DialogDescription>
          If it's a typo, fixing it in the calendar is cleaner. Otherwise add it as one of a
          client's calendar names.
        </DialogDescription>
      </DialogHeader>

      <Field>
        <FieldLabel>Client</FieldLabel>
        <Select items={items} value={clientId} onValueChange={(value) => setClientId(value ?? "")}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Choose a client" />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {session.suggestedClientId && (
          <FieldDescription>Suggested because the names are close.</FieldDescription>
        )}
      </Field>

      <DialogFooter className="gap-2">
        <Button
          variant="outline"
          onClick={() => {
            // A contact the name matched, unless it already belongs to a client.
            const suggested = session.suggestedContacts?.find((contact) => !contact.clientId);
            onClose();
            void navigate({
              to: "/clients/new",
              search: {
                name,
                contact: suggested?.resourceName,
                contactName: suggested?.displayName,
                from: "sessions",
              },
            });
          }}
        >
          New client
        </Button>
        <Button disabled={!clientId || save.isPending} onClick={link}>
          {save.isPending ? "Linking…" : "Link"}
        </Button>
      </DialogFooter>
    </>
  );
}
